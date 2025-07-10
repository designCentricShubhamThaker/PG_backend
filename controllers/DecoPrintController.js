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
            path: 'glass_item_id',
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
            const printingItems = item.team_assignments.printing.map(printingItem => {
              // Get glass item details from the populated glass_item_id
              const glassItem = printingItem.glass_item_id;

              // Structure printing item to match glass item format
              return {
                _id: printingItem._id, // ✅ Keep the actual database ID
                itemId: printingItem.itemId,
                orderNumber: printingItem.orderNumber,
                glass_item_id: glassItem._id,
                glass_name: glassItem.glass_name,
                quantity: glassItem.quantity,
                weight: glassItem.weight,
                neck_size: glassItem.neck_size,
                decoration: glassItem.decoration,
                decoration_no: glassItem.decoration_no,
                decoration_details: glassItem.decoration_details,
                team: "Printing Team",
                status: printingItem.status || 'Pending',
                team_tracking: printingItem.team_tracking || {
                  total_completed_qty: 0,
                  completed_entries: [],
                  last_updated: null
                },
                createdAt: printingItem.createdAt,
                updatedAt: printingItem.updatedAt,
                __v: printingItem.__v
              };
            });

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
    console.error('Error fetching printing orders:', error);
    next(error);
  }
};

export const updatePrintingTracking = async (req, res, next) => {
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
      const item = await OrderItem.findById(itemId).session(session);

      if (!item) throw new Error('Item not found');

      console.log('Processing updates for item:', itemId);
      console.log('Item team assignments:', item.team_assignments);

      for (const update of updatesArray) {
        console.log('Processing update for assignmentId:', update.assignmentId);
        
        // ✅ FIXED: Better assignment lookup with multiple strategies
        let assignment = null;
        
        try {
          // Strategy 1: Direct lookup in PrintingItem collection
          assignment = await PrintingItem.findById(update.assignmentId).session(session);
          console.log('Direct lookup result:', assignment ? 'Found' : 'Not found');
          
          // Strategy 2: If not found, check if it's in the item's team_assignments
          if (!assignment) {
            const printingAssignmentIds = item.team_assignments?.printing || [];
            console.log('Checking assignment IDs:', printingAssignmentIds);
            
            // Check if the assignment ID exists in the item's assignments
            const assignmentExists = printingAssignmentIds.some(
              id => id.toString() === update.assignmentId.toString()
            );
            
            if (assignmentExists) {
              // Try to find it again, maybe it was just created
              assignment = await PrintingItem.findById(update.assignmentId).session(session);
            }
          }
          
          // Strategy 3: If still not found, try to find by glass_item_id and itemId
          if (!assignment) {
            console.log('Attempting to find assignment by glass_item_id and itemId');
            
            // Get all printing assignments for this item
            const allPrintingAssignments = await PrintingItem.find({
              itemId: itemId,
              orderNumber: orderNumber
            }).session(session);
            
            console.log('Found printing assignments for item:', allPrintingAssignments.length);
            
            // Try to match by the assignment ID
            assignment = allPrintingAssignments.find(
              a => a._id.toString() === update.assignmentId.toString()
            );
          }
          
        } catch (lookupError) {
          console.error('Error during assignment lookup:', lookupError);
        }
        
        // ✅ FIXED: If still not found, provide detailed error information
        if (!assignment) {
          console.error('❌ Assignment not found with ID:', update.assignmentId);
          console.error('Available assignment IDs in item:', item.team_assignments?.printing || []);
          
          // Try to get all printing assignments for this order to debug
          const allOrderPrintingAssignments = await PrintingItem.find({
            orderNumber: orderNumber
          }).session(session);
          
          console.error('All printing assignments for order:', allOrderPrintingAssignments.map(a => ({
            id: a._id.toString(),
            itemId: a.itemId,
            glass_name: a.glass_name
          })));
          
          throw new Error(`Printing assignment not found: ${update.assignmentId}. Available assignments: ${allOrderPrintingAssignments.map(a => a._id.toString()).join(', ')}`);
        }

        console.log('✅ Found assignment:', assignment._id.toString());

        // ✅ FIXED: Validate quantity with proper error handling
        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for printing ${assignment.glass_name || 'item'}`
          );
        }

        // ✅ FIXED: Update existing assignment with proper validation
        const updateResult = await PrintingItem.findByIdAndUpdate(
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
          throw new Error(`Failed to update printing assignment: ${assignment._id}`);
        }

        console.log('✅ Successfully updated assignment:', assignment._id.toString());
      }

      // ✅ FIXED: Better completion checking with error handling
      try {
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
                $cond: {
                  if: { $gt: [{ $size: '$printing_assignments' }, 0] },
                  then: {
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
                  },
                  else: false
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

          console.log('✅ Item printing completed');

          // ✅ FIXED: Check if entire order is completed
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
            console.log('✅ Order completed');
          }
        }
      } catch (completionError) {
        console.error('❌ Error checking completion status:', completionError);
        // Don't throw here, just log - the update was successful
      }
    });

    // ✅ CRITICAL FIX: Fetch full order with ALL team assignments for decoration sequence
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

    if (!updatedOrder) {
      throw new Error('Failed to fetch updated order');
    }

    const updatedAssignments = updatesArray.map(update => ({
      assignmentId: update.assignmentId,
      newStatus: update.newStatus,
      totalCompleted: update.newTotalCompleted
    }));

    res.status(200).json({
      success: true,
      message: 'Printing tracking updated successfully',
      data: {
        order: updatedOrder, // ✅ Send full order (with all team assignments!)
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('❌ Error updating printing tracking:', error);
    
    // ✅ FIXED: Better error categorization
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