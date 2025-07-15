import Order from '../models/Order.js';
import CapItem from '../models/CapItem.js';
import OrderItem from '../models/OrderItem.js';
import mongoose from 'mongoose';

const hasAssemblyProcess = (process) => {
  return process && process.includes('Assembly');
};

const hasMetalProcess = (process) => {
  return process && process.includes('Metal');
};

// Helper function to calculate completion status
const calculateCompletionStatus = (assignment) => {
  const hasAssembly = hasAssemblyProcess(assignment.process);
  
  if (hasAssembly) {
    // For assembly caps, both metal and assembly must be completed
    const metalCompleted = assignment.metal_tracking?.total_completed_qty || 0;
    const assemblyCompleted = assignment.assembly_tracking?.total_completed_qty || 0;
    
    return (metalCompleted >= assignment.quantity && assemblyCompleted >= assignment.quantity) 
      ? 'Completed' : 'Pending';
  } else {
    // For non-assembly caps, only check metal tracking
    const metalCompleted = assignment.metal_tracking?.total_completed_qty || 0;
    return metalCompleted >= assignment.quantity ? 'Completed' : 'Pending';
  }
};

// Get cap orders by type
export const getCapOrders = async (req, res, next) => {
  try {
    const { orderType } = req.query;
    
    let matchCondition = {};
    if (orderType === 'pending') {
      matchCondition.order_status = { $ne: 'Completed' };
    } else if (orderType === 'completed') {
      matchCondition.order_status = 'Completed';
    }

    const orders = await Order.find(matchCondition)
      .populate({
        path: 'item_ids',
        match: { 'team_assignments.caps': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.caps',
          model: 'CapItem'
        }
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out orders that don't have cap assignments
    const filteredOrders = orders.filter(order => 
      order.item_ids && order.item_ids.length > 0
    );

    res.status(200).json({ success: true, data: filteredOrders });
  } catch (error) {
    next(error);
  }
};

export const updateCapTracking = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { orderNumber, itemId, updates } = req.body;

    if (!orderNumber || !itemId || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields or invalid updates format.'
      });
    }

    await session.withTransaction(async () => {
      const item = await OrderItem.findById(itemId)
        .populate('team_assignments.caps')
        .session(session);

      if (!item) throw new Error('Item not found');

      const capAssignments = item.team_assignments?.caps || [];

      // Process each update
      for (const update of updates) {
        const { assignmentId, processType, newEntry, newTotalCompleted } = update;
        
        if (!assignmentId || !processType || !newEntry || newTotalCompleted === undefined) {
          throw new Error('Invalid update format');
        }

        const assignment = capAssignments.find(a => a._id.toString() === assignmentId);
        if (!assignment) {
          throw new Error(`Cap assignment not found: ${assignmentId}`);
        }

        // Validate process type based on assignment's process
        const hasAssembly = hasAssemblyProcess(assignment.process);
        const hasMetal = hasMetalProcess(assignment.process);

        if (processType === 'metal' && !hasMetal) {
          throw new Error(`Assignment ${assignmentId} does not have metal process`);
        }

        if (processType === 'assembly' && !hasAssembly) {
          throw new Error(`Assignment ${assignmentId} does not have assembly process`);
        }

        // Get current completed quantity for the specific process
        const trackingField = processType === 'metal' ? 'metal_tracking' : 'assembly_tracking';
        const currentCompleted = assignment[trackingField]?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (newEntry.quantity > remaining) {
          throw new Error(`Quantity ${newEntry.quantity} exceeds remaining quantity ${remaining} for ${processType} process of cap ${assignment.cap_name}`);
        }

        // First update the tracking data
        const updateFields = {
          [`${trackingField}.total_completed_qty`]: newTotalCompleted,
          [`${trackingField}.last_updated`]: new Date()
        };

        await CapItem.findByIdAndUpdate(
          assignmentId,
          {
            $set: updateFields,
            $push: {
              [`${trackingField}.completed_entries`]: {
                ...newEntry,
                date: new Date(newEntry.date)
              }
            }
          },
          { session, new: true }
        );

        // Now get the updated assignment to calculate proper status
        const updatedAssignment = await CapItem.findById(assignmentId).session(session);
        const calculatedStatus = calculateCompletionStatus(updatedAssignment);

        // Update status if it's different from current status
        if (updatedAssignment.status !== calculatedStatus) {
          await CapItem.findByIdAndUpdate(
            assignmentId,
            { $set: { status: calculatedStatus } },
            { session }
          );
        }
      }

      // Check if all cap assignments in the item are completed
      const itemCompletionResult = await OrderItem.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
        {
          $lookup: {
            from: 'capitems',
            localField: 'team_assignments.caps',
            foreignField: '_id',
            as: 'cap_assignments'
          }
        },
        {
          $addFields: {
            allCapsCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$cap_assignments',
                  as: 'assignment',
                  in: {
                    $cond: {
                      if: { $regexMatch: { input: '$$assignment.process', regex: 'Assembly' } },
                      then: {
                        $and: [
                          {
                            $gte: [
                              { $ifNull: ['$$assignment.metal_tracking.total_completed_qty', 0] },
                              '$$assignment.quantity'
                            ]
                          },
                          {
                            $gte: [
                              { $ifNull: ['$$assignment.assembly_tracking.total_completed_qty', 0] },
                              '$$assignment.quantity'
                            ]
                          }
                        ]
                      },
                      else: {
                        $gte: [
                          { $ifNull: ['$$assignment.metal_tracking.total_completed_qty', 0] },
                          '$$assignment.quantity'
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        },
        { $project: { allCapsCompleted: 1 } }
      ]).session(session);

      // Update item status if all caps are completed
      if (itemCompletionResult[0]?.allCapsCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.caps': 'Completed' } },
          { session }
        );

        // Check if all items in the order are completed
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
                    from: 'capitems',
                    localField: 'team_assignments.caps',
                    foreignField: '_id',
                    as: 'cap_assignments'
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
                        if: { $gt: [{ $size: '$$item.cap_assignments' }, 0] },
                        then: {
                          $allElementsTrue: {
                            $map: {
                              input: '$$item.cap_assignments',
                              as: 'assignment',
                              in: {
                                $cond: {
                                  if: { $regexMatch: { input: '$$assignment.process', regex: 'Assembly' } },
                                  then: {
                                    $and: [
                                      {
                                        $gte: [
                                          { $ifNull: ['$$assignment.metal_tracking.total_completed_qty', 0] },
                                          '$$assignment.quantity'
                                        ]
                                      },
                                      {
                                        $gte: [
                                          { $ifNull: ['$$assignment.assembly_tracking.total_completed_qty', 0] },
                                          '$$assignment.quantity'
                                        ]
                                      }
                                    ]
                                  },
                                  else: {
                                    $gte: [
                                      { $ifNull: ['$$assignment.metal_tracking.total_completed_qty', 0] },
                                      '$$assignment.quantity'
                                    ]
                                  }
                                }
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

    // Return updated order data
    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        match: { 'team_assignments.caps': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.caps',
          model: 'CapItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { caps: item.team_assignments.caps }
      }))
    };

    const updatedAssignments = updates.map(update => ({
      assignmentId: update.assignmentId,
      processType: update.processType,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Cap tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments
      }
    });
  } catch (error) {
    console.error('Error updating cap tracking:', error);
    if (error.message.includes('not found') || error.message.includes('exceeds') || error.message.includes('Invalid')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  } finally {
    await session.endSession();
  }
};

// Additional utility function to fix existing data
export const fixCapStatuses = async (req, res, next) => {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Get all cap items
      const capItems = await CapItem.find({}).session(session);
      
      for (const capItem of capItems) {
        const calculatedStatus = calculateCompletionStatus(capItem);
        
        // Update status if it's different
        if (capItem.status !== calculatedStatus) {
          await CapItem.findByIdAndUpdate(
            capItem._id,
            { $set: { status: calculatedStatus } },
            { session }
          );
        }
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Cap statuses fixed successfully'
    });
  } catch (error) {
    console.error('Error fixing cap statuses:', error);
    next(error);
  } finally {
    await session.endSession();
  }
};