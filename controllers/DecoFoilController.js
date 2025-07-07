import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import FoilingItem from '../models/FoilingItem.js';
import mongoose from 'mongoose';

export const getFoilOrders = async (req, res, next) => {
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
          path: 'team_assignments.foiling',
          model: 'FoilingItem',
          populate: {
            path: 'glass_item_id',
            model: 'GlassItem'
          }
        }
      })
      .lean();

    const filteredOrders = orders
      .filter(order =>
        order.item_ids.some(item => item.team_assignments?.foiling?.length > 0)
      )
      .map(order => {
        const filteredItems = order.item_ids
          .filter(item => item.team_assignments?.foiling?.length > 0)
          .map(item => {
            const foilingItems = item.team_assignments.foiling.map(foilingItem => {
              const glassItem = foilingItem.glass_item_id;
              return {
                _id: foilingItem._id, 
                itemId: foilingItem.itemId,
                orderNumber: foilingItem.orderNumber,
                glass_item_id: glassItem._id,
                glass_name: glassItem.glass_name,
                quantity: glassItem.quantity,
                weight: glassItem.weight,
                neck_size: glassItem.neck_size,
                decoration: glassItem.decoration,
                decoration_no: glassItem.decoration_no,
                decoration_details: glassItem.decoration_details,
                team: "Foiling Team",
                status: foilingItem.status || 'Pending',
                team_tracking: foilingItem.team_tracking || {
                  total_completed_qty: 0,
                  completed_entries: [],
                  last_updated: null
                },
                createdAt: foilingItem.createdAt,
                updatedAt: foilingItem.updatedAt,
                __v: foilingItem.__v
              };
            });

            return {
              ...item,
              team_assignments: { foiling: foilingItems }
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
    console.error('Error fetching foiling orders:', error);
    next(error);
  }
};

export const updateFoilTracking = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const {
      orderNumber,
      itemId,
      updates,
      assignmentId,
      newEntry,
      newTotalCompleted,
      newStatus
    } = req.body;

    const isBulkUpdate = Array.isArray(updates) && updates.length > 0;
    const isSingleUpdate = assignmentId && newEntry && newTotalCompleted !== undefined && newStatus;

    if (!orderNumber || !itemId || (!isBulkUpdate && !isSingleUpdate)) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const updatesArray = isBulkUpdate
      ? updates
      : [{ assignmentId, newEntry, newTotalCompleted, newStatus }];

    await session.withTransaction(async () => {
      const item = await OrderItem.findById(itemId)
        .populate('team_assignments.foiling')
        .session(session);

      if (!item) throw new Error('Item not found');

      const foilingAssignments = item.team_assignments?.foiling || [];

      for (const update of updatesArray) {
        let assignment = foilingAssignments.find(
          a => a._id && a._id.toString() === update.assignmentId.toString()
        );

        if (!assignment) {
          try {
            assignment = await FoilingItem.findById(update.assignmentId).session(session);
          } catch (lookupError) {
            console.log('Direct lookup failed:', lookupError.message);
          }
        }

        if (!assignment) {
          const isNewAssignment = update.assignmentId.toString().startsWith('temp_');
          if (isNewAssignment) {
            throw new Error(`Assignment not properly created. Please refresh and try again.`);
          } else {
            throw new Error(`Foiling assignment not found: ${update.assignmentId}`);
          }
        }

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for foiling ${assignment.glass_name || 'item'}`
          );
        }

        const updateResult = await FoilingItem.findByIdAndUpdate(
          assignment._id,
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

        if (!updateResult) {
          throw new Error(`Failed to update foiling assignment: ${assignment._id}`);
        }
      }

      try {
        const itemCompletionResult = await OrderItem.aggregate([
          { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
          {
            $lookup: {
              from: 'foilingitems',
              localField: 'team_assignments.foiling',
              foreignField: '_id',
              as: 'foiling_assignments'
            }
          },
          {
            $addFields: {
              allFoilingCompleted: {
                $cond: {
                  if: { $gt: [{ $size: '$foiling_assignments' }, 0] },
                  then: {
                    $allElementsTrue: {
                      $map: {
                        input: '$foiling_assignments',
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
                  else: false
                }
              }
            }
          },
          { $project: { allFoilingCompleted: 1 } }
        ]).session(session);

        if (itemCompletionResult[0]?.allFoilingCompleted) {
          await OrderItem.findByIdAndUpdate(
            itemId,
            { $set: { 'team_status.foiling': 'Completed' } },
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
                      from: 'foilingitems',
                      localField: 'team_assignments.foiling',
                      foreignField: '_id',
                      as: 'foiling_assignments'
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
                          if: { $gt: [{ $size: '$$item.foiling_assignments' }, 0] },
                          then: {
                            $allElementsTrue: {
                              $map: {
                                input: '$$item.foiling_assignments',
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
      } catch (completionError) {
        console.error('Error checking completion status:', completionError);
      }
    });

    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        match: { 'team_assignments.foiling': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.foiling',
          model: 'FoilingItem',
          populate: {
            path: 'glass_item_id',
            model: 'GlassItem'
          }
        }
      })
      .lean();

    if (!updatedOrder) {
      throw new Error('Failed to fetch updated order');
    }

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: {
          foiling: item.team_assignments.foiling.map(foilingItem => {
            const glassItem = foilingItem.glass_item_id;
            return {
              _id: foilingItem._id,
              itemId: foilingItem.itemId,
              orderNumber: foilingItem.orderNumber,
              glass_item_id: glassItem._id,
              glass_name: glassItem.glass_name,
              quantity: glassItem.quantity,
              weight: glassItem.weight,
              neck_size: glassItem.neck_size,
              decoration: glassItem.decoration,
              decoration_no: glassItem.decoration_no,
              decoration_details: glassItem.decoration_details,
              team: 'Foiling Team',
              status: foilingItem.status || 'Pending',
              team_tracking: foilingItem.team_tracking || {
                total_completed_qty: 0,
                completed_entries: [],
                last_updated: null
              },
              createdAt: foilingItem.createdAt,
              updatedAt: foilingItem.updatedAt,
              __v: foilingItem.__v
            };
          })
        }
      }))
    };

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Foiling tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('Error updating foiling tracking:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message.includes('exceeds') || error.message.includes('required')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.message.includes('refresh')) {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  } finally {
    await session.endSession();
  }
};