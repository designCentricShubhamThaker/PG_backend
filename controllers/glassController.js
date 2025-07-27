import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import GlassItem from '../models/GlassItem.js';
import mongoose from 'mongoose';
import { updateOrderCompletionStatus } from '../helpers/ordercompletion.js';


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
        populate: [
          { path: 'team_assignments.glass', model: 'GlassItem' },
          { path: 'team_assignments.printing', model: 'PrintingItem' },
          { path: 'team_assignments.foiling', model: 'FoilingItem' },
          { path: 'team_assignments.coating', model: 'CoatingItem' },
          { path: 'team_assignments.frosting', model: 'FrostingItem' }
        ]
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
      return res.status(400).json({
        success: false,
        message: 'Missing required fields.'
      });
    }

    const updatesArray = isBulkUpdate
      ? updates
      : [{ assignmentId, newEntry, newTotalCompleted, newStatus }];

    await session.withTransaction(async () => {
      const item = await OrderItem.findById(itemId)
        .populate('team_assignments.glass')
        .session(session);

      if (!item) throw new Error('Item not found');

      const glassAssignments = item.team_assignments?.glass || [];

      for (const update of updatesArray) {
        const assignment = glassAssignments.find(
          a => a._id.toString() === update.assignmentId
        );
        if (!assignment) throw new Error(`Glass assignment not found: ${update.assignmentId}`);

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for glass ${assignment.glass_name}`
          );
        }

        await GlassItem.findByIdAndUpdate(
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

      // ✅ SIMPLE FIX: Replace all the complex aggregation logic with one line!
      await updateOrderCompletionStatus(orderNumber, itemId, 'glass', session);
    });

    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        populate: [
          { path: 'team_assignments.glass', model: 'GlassItem' },
          { path: 'team_assignments.printing', model: 'PrintingItem' },
          { path: 'team_assignments.foiling', model: 'FoilingItem' },
          { path: 'team_assignments.coating', model: 'CoatingItem' },
          { path: 'team_assignments.frosting', model: 'FrostingItem' }
        ]
      })
      .lean();

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Glass tracking updated successfully',
      data: {
        order: updatedOrder,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });
  } catch (error) {
    console.error('Error updating glass tracking:', error);
    if (error.message.includes('not found') || error.message.includes('exceeds')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  } finally {
    await session.endSession();
  }
};