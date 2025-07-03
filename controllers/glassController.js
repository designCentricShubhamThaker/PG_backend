import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js'; // Add this import
import GlassItem from '../models/GlassItem.js';
import mongoose from 'mongoose';


export const getGlassOrders = async (req, res, next) => {
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
          path: 'team_assignments.glass',
          model: 'GlassItem'
        }
      })
      .lean();

    const filteredOrders = orders
      .filter(order =>
        order.item_ids.some(item => item.team_assignments?.glass?.length > 0)
      )
      .map(order => {
        const filteredItems = order.item_ids
          .filter(item => item.team_assignments?.glass?.length > 0)
          .map(item => {
            const glassItems = item.team_assignments.glass;
            return {
              ...item,
              team_assignments: { glass: glassItems }
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

export const updateGlassTracking = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { orderNumber, itemId, assignmentId, newEntry, newTotalCompleted, newStatus } = req.body;

    if (!orderNumber || !itemId || !assignmentId || !newEntry || newTotalCompleted === undefined || !newStatus) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: orderNumber, itemId, assignmentId, newEntry, newTotalCompleted, newStatus'
      });
    }

    await session.withTransaction(async () => {
      const item = await OrderItem.findById(itemId)
        .populate('team_assignments.glass')
        .session(session);

      if (!item) throw new Error('Item not found');

      const glassAssignment = item.team_assignments?.glass.find(g => g._id.toString() === assignmentId);
      if (!glassAssignment) throw new Error(`Glass assignment not found: ${assignmentId}`);

      const currentCompleted = glassAssignment.team_tracking?.total_completed_qty || 0;
      const remaining = glassAssignment.quantity - currentCompleted;

      if (newEntry.quantity > remaining) {
        throw new Error(`Quantity ${newEntry.quantity} exceeds remaining quantity ${remaining} for assignment ${glassAssignment.glass_name}`);
      }

      await GlassItem.findByIdAndUpdate(
        assignmentId,
        {
          $set: {
            'team_tracking.total_completed_qty': newTotalCompleted,
            'team_tracking.last_updated': new Date(),
            status: newStatus
          },
          $push: {
            'team_tracking.completed_entries': {
              ...newEntry,
              date: new Date(newEntry.date)
            }
          }
        },
        { session, new: true }
      );

      // Check if all glass assignments are completed for this item
      const itemCompletionResult = await OrderItem.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
        {
          $lookup: {
            from: 'glassitems',
            localField: 'team_assignments.glass',
            foreignField: '_id',
            as: 'glass_assignments'
          }
        },
        {
          $addFields: {
            allGlassCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$glass_assignments',
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
        { $project: { allGlassCompleted: 1 } }
      ]).session(session);

      if (itemCompletionResult[0]?.allGlassCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.glass': 'Completed' } },
          { session }
        );

        // Check if all items in the order are complete
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
                    from: 'glassitems',
                    localField: 'team_assignments.glass',
                    foreignField: '_id',
                    as: 'glass_assignments'
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
                        if: { $gt: [{ $size: '$$item.glass_assignments' }, 0] },
                        then: {
                          $allElementsTrue: {
                            $map: {
                              input: '$$item.glass_assignments',
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
        match: { 'team_assignments.glass': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.glass',
          model: 'GlassItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { glass: item.team_assignments.glass }
      }))
    };

    res.status(200).json({
      success: true,
      message: 'Glass tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignment: {
          assignmentId,
          newStatus,
          totalCompleted: newTotalCompleted
        }
      }
    });

  } catch (error) {
    console.error('Error updating glass tracking:', error);

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
