// import Order from "../models/Order.js";

// export const getBoxOrders = async (req, res) => {
//   try {
//     const orders = await Order.find()
//       .populate({
//         path: 'item_ids',
//         populate: {
//           path: 'team_assignments.boxes',
//           model: 'BoxItem'
//         }
//       })
//       .lean();

//     const filteredOrders = orders
//       .filter(order =>
//         order.item_ids.some(item => item.team_assignments?.boxes?.length > 0)
//       )
//       .map(order => {
//         const filteredItems = order.item_ids
//           .filter(item => item.team_assignments?.boxes?.length > 0)
//           .map(item => {
//             const boxItems = item.team_assignments.boxes;
//             return {
//               ...item,
//               team_assignments: { boxes: boxItems }
//             };
//           });

//         return {
//           ...order,
//           item_ids: filteredItems
//         };
//       });

//     res.status(200).json({ success: true, data: filteredOrders });
//   } catch (error) {
//     console.error('Error fetching cap orders:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };


import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import BoxItem from '../models/BoxItem.js';
import mongoose from 'mongoose';

// Get Orders with Box Assignments
export const getBoxOrders = async (req, res, next) => {
  try {
    const { orderType } = req.query;
    const filter = {};

    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }

    const orders = await Order.find(filter)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.boxes',
          model: 'BoxItem'
        }
      })
      .lean();

    const filteredOrders = orders
      .filter(order =>
        order.item_ids.some(item => item.team_assignments?.boxes?.length > 0)
      )
      .map(order => {
        const filteredItems = order.item_ids
          .filter(item => item.team_assignments?.boxes?.length > 0)
          .map(item => {
            const boxItems = item.team_assignments.boxes;
            return {
              ...item,
              team_assignments: { boxes: boxItems }
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

// Update Box Tracking
export const updateBoxTracking = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { orderNumber, itemId, updates, assignmentId, newEntry, newTotalCompleted, newStatus } = req.body;

    const isBulkUpdate = Array.isArray(updates) && updates.length > 0;
    const isSingleUpdate = assignmentId && newEntry && newTotalCompleted !== undefined && newStatus;

    if (!orderNumber || !itemId || (!isBulkUpdate && !isSingleUpdate)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields.'
      });
    }

    const updatesArray = isBulkUpdate ? updates : [{ assignmentId, newEntry, newTotalCompleted, newStatus }];

    await session.withTransaction(async () => {
      const item = await OrderItem.findById(itemId)
        .populate('team_assignments.boxes')
        .session(session);

      if (!item) throw new Error('Item not found');

      const boxAssignments = item.team_assignments?.boxes || [];

      for (const update of updatesArray) {
        const assignment = boxAssignments.find(a => a._id.toString() === update.assignmentId);
        if (!assignment) throw new Error(`Box assignment not found: ${update.assignmentId}`);

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(`Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for box ${assignment.box_name}`);
        }

        await BoxItem.findByIdAndUpdate(
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

      // Check item completion
      const itemCompletionResult = await OrderItem.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
        {
          $lookup: {
            from: 'boxitems',
            localField: 'team_assignments.boxes',
            foreignField: '_id',
            as: 'box_assignments'
          }
        },
        {
          $addFields: {
            allBoxesCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$box_assignments',
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
        { $project: { allBoxesCompleted: 1 } }
      ]).session(session);

      if (itemCompletionResult[0]?.allBoxesCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.boxes': 'Completed' } },
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
                    from: 'boxitems',
                    localField: 'team_assignments.boxes',
                    foreignField: '_id',
                    as: 'box_assignments'
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
                        if: { $gt: [{ $size: '$$item.box_assignments' }, 0] },
                        then: {
                          $allElementsTrue: {
                            $map: {
                              input: '$$item.box_assignments',
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
        match: { 'team_assignments.boxes': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.boxes',
          model: 'BoxItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { boxes: item.team_assignments.boxes }
      }))
    };

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Box tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });
  } catch (error) {
    console.error('Error updating box tracking:', error);
    if (error.message.includes('not found') || error.message.includes('exceeds')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  } finally {
    await session.endSession();
  }
};
