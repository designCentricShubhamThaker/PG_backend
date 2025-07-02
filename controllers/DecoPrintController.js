import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import PrintingItem from '../models/PrintingItem.js';
import mongoose from 'mongoose';


export const getPrintingOrders = async (req, res, next) => {
  try {
    const { orderType } = req.query;
    let filter = {};
    
    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }

    const orders = await Order.find(filter)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.printing',
          model: 'PrintingItem',
          populate: {
            path: 'glass_item_id', // ✅ This is what brings in glass_name
            model: 'GlassItem'
          }
        }
      })
      .lean();

    const filteredOrders = orders
      .filter(order =>
        order.item_ids.some(item => item.team_assignments?.printing?.length > 0)
      )
      .map(order => {
        const filteredItems = order.item_ids
          .filter(item => item.team_assignments?.printing?.length > 0)
          .map(item => {
            const printingItems = item.team_assignments.printing;
            return {
              ...item,
              team_assignments: { printing: printingItems }
            };
          });

        return {
          ...order,
          item_ids: filteredItems
        };
      });

    res.status(200).json({
      success: true,
      count: filteredOrders.length,
      data: filteredOrders
    });
  } catch (error) {
    next(error);
  }
};


export const updatePrintingTracking = async (req, res, next) => {
  const session = await mongoose.startSession();
  
  try {
    const { orderNumber, itemId, updates, assignmentId, newEntry, newTotalCompleted, newStatus } = req.body;

    const isBulkUpdate = Array.isArray(updates) && updates.length > 0;
    const isSingleUpdate = assignmentId && newEntry && newTotalCompleted !== undefined && newStatus;

    if (!orderNumber || !itemId || (!isBulkUpdate && !isSingleUpdate)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields. Provide either: (orderNumber, itemId, updates[]) OR (orderNumber, itemId, assignmentId, newEntry, newTotalCompleted, newStatus)'
      });
    }

    const updatesArray = isBulkUpdate ? updates : [{
      assignmentId,
      newEntry,
      newTotalCompleted,
      newStatus
    }];

    for (const update of updatesArray) {
      if (!update.assignmentId || !update.newEntry || update.newTotalCompleted === undefined || !update.newStatus) {
        return res.status(400).json({
          success: false,
          message: 'Invalid update structure. Each update must have assignmentId, newEntry, newTotalCompleted, and newStatus'
        });
      }
    }

    await session.withTransaction(async () => {
      const item = await OrderItem.findById(itemId)
        .populate('team_assignments.printing')
        .session(session);

      if (!item) {
        throw new Error('Item not found');
      }

      const printingAssignments = item.team_assignments?.printing || [];

      for (const update of updatesArray) {
        const assignment = printingAssignments.find(a => a._id.toString() === update.assignmentId);
        
        if (!assignment) {
          throw new Error(`Printing assignment not found: ${update.assignmentId}`);
        }

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;
        
        if (update.newEntry.quantity > remaining) {
          throw new Error(`Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for assignment ${assignment.printing_name}`);
        }

        await PrintingItem.findByIdAndUpdate(
          update.assignmentId,
          {
            $set: {
              'team_tracking.total_completed_qty': update.newTotalCompleted,
              'team_tracking.last_updated': new Date(),
              status: update.newStatus
            },
            $push: {
              'team_tracking.completed_entries': {
                ...update.newEntry,
                date: new Date(update.newEntry.date)
              }
            }
          },
          { session, new: true }
        );
      }

      const itemCompletionResult = await OrderItem.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
        {
          $lookup: {
            from: 'printingitems',
            localField: 'team_assignments.printing',
            foreignField: '_id',
            as: 'printing_assignments'
          }
        },
        {
          $addFields: {
            allPrintingCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$printing_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        { $project: { allPrintingCompleted: 1 } }
      ]).session(session);

      if (itemCompletionResult[0]?.allPrintingCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.printing': 'Completed' } },
          { session }
        );

        const orderCompletionResult = await Order.aggregate([
          { $match: { order_number: orderNumber } },
          {
            $lookup: {
              from: 'orderitems',
              localField: 'item_ids',
              foreignField: '_id',
              as: 'items',
              pipeline: [
                {
                  $lookup: {
                    from: 'printingitems',
                    localField: 'team_assignments.printing',
                    foreignField: '_id',
                    as: 'printing_assignments'
                  }
                }
              ]
            }
          },
          {
            $addFields: {
              allItemsCompleted: {
                $allElementsTrue: {
                  $map: {
                    input: '$items',
                    as: 'item',
                    in: {
                      $cond: {
                        if: { $gt: [{ $size: '$$item.printing_assignments' }, 0] },
                        then: {
                          $allElementsTrue: {
                            $map: {
                              input: '$$item.printing_assignments',
                              as: 'assignment',
                              in: {
                                $gte: [
                                  { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                                  '$$assignment.quantity'
                                ]
                              }
                            }
                          }
                        },
                        else: true
                      }
                    }
                  }
                }
              }
            }
          },
          { $project: { allItemsCompleted: 1, order_status: 1 } }
        ]).session(session);

        const orderResult = orderCompletionResult[0];
        if (orderResult?.allItemsCompleted && orderResult.order_status !== 'Completed') {
          await Order.findOneAndUpdate(
            { order_number: orderNumber },
            { $set: { order_status: 'Completed' } },
            { session }
          );
        }
      }
    });

    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        match: { 'team_assignments.printing': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.printing',
          model: 'PrintingItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { printing: item.team_assignments.printing }
      }))
    };

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Printing tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('Error updating printing tracking:', error);
    
    if (error.message.includes('not found') || error.message.includes('exceeds')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    next(error);
  } finally {
    await session.endSession();
  }
};