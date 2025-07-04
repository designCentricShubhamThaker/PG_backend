import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import FrostingItem from '../models/FrostingItem.js';
import mongoose from 'mongoose';

export const getFrostOrders = async (req, res, next) => {
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
          path: 'team_assignments.frostinging',
          model: 'FrostingItem',
          populate: {
            path: 'glass_item_id',
            model: 'GlassItem'
          }
        }
      })
      .lean();

    const filteredOrders = orders
      .filter(order =>
        order.item_ids.some(item => item.team_assignments?.frosting?.length > 0)
      )
      .map(order => {
        const filteredItems = order.item_ids
          .filter(item => item.team_assignments?.frosting?.length > 0)
          .map(item => {
            const FrostingItems = item.team_assignments.frostinging.map(FrostingItem => {
              const glassItem = FrostingItem.glass_item_id;
              
              return {
                _id: FrostingItem._id,
                itemId: FrostingItem.itemId,
                orderNumber: FrostingItem.orderNumber,
                glass_item_id: glassItem._id,
                glass_name: glassItem.glass_name,
                quantity: glassItem.quantity,
                weight: glassItem.weight,
                neck_size: glassItem.neck_size,
                decoration: glassItem.decoration,
                decoration_no: glassItem.decoration_no,
                decoration_details: glassItem.decoration_details,
                team: "Frost Team",
                status: FrostingItem.status || 'Pending',
                team_tracking: FrostingItem.team_tracking || {
                  total_completed_qty: 0,
                  completed_entries: [],
                  last_updated: null
                },
                createdAt: FrostingItem.createdAt,
                updatedAt: FrostingItem.updatedAt,
                __v: FrostingItem.__v
              };
            });

            return {
              ...item,
              team_assignments: { frost: FrostingItems }
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
    console.error('Error fetching frost orders:', error);
    next(error);
  }
};

export const updateFrostTracking = async (req, res, next) => {
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
        .populate('team_assignments.frostinging')
        .session(session);

      if (!item) {
        throw new Error('Item not found');
      }

      const frostAssignments = item.team_assignments?.frosting || [];

      for (const update of updatesArray) {
        const assignment = frostAssignments.find(a => a._id.toString() === update.assignmentId);
        
        if (!assignment) {
          throw new Error(`Frost assignment not found: ${update.assignmentId}`);
        }

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;
        
        if (update.newEntry.quantity > remaining) {
          throw new Error(`Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for assignment ${assignment.glass_name}`);
        }

        await FrostingItem.findByIdAndUpdate(
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

      // Check if all frost assignments for this item are completed
      const itemCompletionResult = await OrderItem.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
        {
          $lookup: {
            from: 'FrostingItems',
            localField: 'team_assignments.frostinging',
            foreignField: '_id',
            as: 'frost_assignments'
          }
        },
        {
          $addFields: {
            allFrostCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$frost_assignments',
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
        { $project: { allFrostCompleted: 1 } }
      ]).session(session);

      if (itemCompletionResult[0]?.allFrostCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.frosting': 'Completed' } },
          { session }
        );
      }
    });

    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        match: { 'team_assignments.frostinging': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.frostinging',
          model: 'FrostingItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { frost: item.team_assignments.frostinging }
      }))
    };

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Frost tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('Error updating frost tracking:', error);
    
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