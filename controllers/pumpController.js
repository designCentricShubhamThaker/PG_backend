import Order from '../models/Order.js';
import PumpItem from '../models/PumpItem.js';
import OrderItem from '../models/OrderItem.js';
import mongoose from 'mongoose';

// Get all pump items
export const getAllPumpItems = async (req, res, next) => {
  try {
    const pumpItems = await PumpItem.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: pumpItems });
  } catch (error) {
    next(error);
  }
};


export const updatePumpTracking = async (req, res, next) => {
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
        .populate('team_assignments.pumps')
        .session(session);

      if (!item) throw new Error('Item not found');

      const pumpAssignments = item.team_assignments?.pumps || [];

      for (const update of updatesArray) {
        const assignment = pumpAssignments.find(a => a._id.toString() === update.assignmentId);
        if (!assignment) throw new Error(`Pump assignment not found: ${update.assignmentId}`);

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(`Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for pump ${assignment.pump_name}`);
        }

        await PumpItem.findByIdAndUpdate(
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
            from: 'pumpitems',
            localField: 'team_assignments.pumps',
            foreignField: '_id',
            as: 'pump_assignments'
          }
        },
        {
          $addFields: {
            allPumpsCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$pump_assignments',
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
        { $project: { allPumpsCompleted: 1 } }
      ]).session(session);

      if (itemCompletionResult[0]?.allPumpsCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.pumps': 'Completed' } },
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
                    from: 'pumpitems',
                    localField: 'team_assignments.pumps',
                    foreignField: '_id',
                    as: 'pump_assignments'
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
                        if: { $gt: [{ $size: '$$item.pump_assignments' }, 0] },
                        then: {
                          $allElementsTrue: {
                            $map: {
                              input: '$$item.pump_assignments',
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
        match: { 'team_assignments.pumps': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.pumps',
          model: 'PumpItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { pumps: item.team_assignments.pumps }
      }))
    };

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Pump tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });
  } catch (error) {
    console.error('Error updating pump tracking:', error);
    if (error.message.includes('not found') || error.message.includes('exceeds')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  } finally {
    await session.endSession();
  }
};
;