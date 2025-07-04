// controllers/coatingController.js
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import CoatingItem from '../models/CoatingItem.js';
import mongoose from 'mongoose';

export const getCoatingOrders = async (req, res, next) => {
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
          path: 'team_assignments.caoting',
          model: 'CoatingItem',
          populate: {
            path: 'glass_item_id',
            model: 'GlassItem'
          }
        }
      })
      .lean();

    const filteredOrders = orders
      .filter(order =>
        order.item_ids.some(item => item.team_assignments?.coatinging?.length > 0)
      )
      .map(order => {
        const filteredItems = order.item_ids
          .filter(item => item.team_assignments?.coatinging?.length > 0)
          .map(item => {
            const coatingItems = item.team_assignments.caoting.map(coatingItem => {
              const glassItem = coatingItem.glass_item_id;
              
              return {
                _id: coatingItem._id,
                itemId: coatingItem.itemId,
                orderNumber: coatingItem.orderNumber,
                glass_item_id: glassItem._id,
                glass_name: glassItem.glass_name,
                quantity: glassItem.quantity,
                weight: glassItem.weight,
                neck_size: glassItem.neck_size,
                decoration: glassItem.decoration,
                decoration_no: glassItem.decoration_no,
                decoration_details: glassItem.decoration_details,
                team: "Coating Team",
                status: coatingItem.status || 'Pending',
                team_tracking: coatingItem.team_tracking || {
                  total_completed_qty: 0,
                  completed_entries: [],
                  last_updated: null
                },
                createdAt: coatingItem.createdAt,
                updatedAt: coatingItem.updatedAt,
                __v: coatingItem.__v
              };
            });

            return {
              ...item,
              team_assignments: { coating: coatingItems }
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
    console.error('Error fetching coating orders:', error);
    next(error);
  }
};

export const updateCoatingTracking = async (req, res, next) => {
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
        .populate('team_assignments.caoting')
        .session(session);

      if (!item) {
        throw new Error('Item not found');
      }

      const coatingAssignments = item.team_assignments?.coatinging || [];

      for (const update of updatesArray) {
        const assignment = coatingAssignments.find(a => a._id.toString() === update.assignmentId);
        
        if (!assignment) {
          throw new Error(`Coating assignment not found: ${update.assignmentId}`);
        }

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;
        
        if (update.newEntry.quantity > remaining) {
          throw new Error(`Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for assignment ${assignment.glass_name}`);
        }

        await CoatingItem.findByIdAndUpdate(
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

      // Check if all coating assignments for this item are completed
      const itemCompletionResult = await OrderItem.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
        {
          $lookup: {
            from: 'coatingitems',
            localField: 'team_assignments.caoting',
            foreignField: '_id',
            as: 'coating_assignments'
          }
        },
        {
          $addFields: {
            allCoatingCompleted: {
              $allElementsTrue: {
                $map: {
                  input: '$coating_assignments',
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
        { $project: { allCoatingCompleted: 1 } }
      ]).session(session);

      if (itemCompletionResult[0]?.allCoatingCompleted) {
        await OrderItem.findByIdAndUpdate(
          itemId,
          { $set: { 'team_status.coatinging': 'Completed' } },
          { session }
        );
      }
    });

    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        match: { 'team_assignments.caoting': { $exists: true, $ne: [] } },
        populate: {
          path: 'team_assignments.caoting',
          model: 'CoatingItem'
        }
      })
      .lean();

    const responseData = {
      ...updatedOrder,
      item_ids: updatedOrder.item_ids.map(item => ({
        ...item,
        team_assignments: { coating: item.team_assignments.caoting }
      }))
    };

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Coating tracking updated successfully',
      data: {
        order: responseData,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('Error updating coating tracking:', error);
    
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

