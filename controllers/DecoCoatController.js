import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import CoatingItem from '../models/CoatingItem.js';

import mongoose from 'mongoose';

// Decoration sequences - must match your socket logic
const DECORATION_SEQUENCES = {
  'coating': ['coating'],
  'coating_printing': ['coating', 'printing'],
  'coating_printing_foiling': ['coating', 'printing', 'foiling'],
  'printing': ['printing'],
  'printing_foiling': ['printing', 'foiling'],
  'foiling': ['foiling'],
  'coating_foiling': ['coating', 'foiling'],
  'frosting': ['frosting'],
  'frosting_printing': ['frosting', 'printing'],
  'frosting_printing_foiling': ['frosting', 'printing', 'foiling']
};

// ============= COATING FUNCTIONS =============

export const getCoatingOrders = async (req, res, next) => {
  try {
    const { orderType } = req.query;
    let filter = {};

    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }

    // Fetch orders with ALL team assignments populated for sequence checking
    const orders = await Order.find(filter)
      .populate({
        path: 'item_ids',
        populate: [
          { 
            path: 'team_assignments.glass', 
            model: 'GlassItem' 
          },
          {
            path: 'team_assignments.coating',
            model: 'CoatingItem',
            populate: {
              path: 'glass_item_id',
              model: 'GlassItem'
            }
          },
          { 
            path: 'team_assignments.printing', 
            model: 'PrintingItem' 
          },
          { 
            path: 'team_assignments.foiling', 
            model: 'FoilingItem' 
          },
          { 
            path: 'team_assignments.frosting', 
            model: 'FrostingItem' 
          }
        ]
      })
      .lean();

    console.log(`📊 Found ${orders.length} orders, filtering for coating team with sequence logic`);

    const filteredOrders = orders
      .map(order => {
        console.log(`🔍 Processing order: ${order.order_number}`);
        
        const validCoatingItems = [];

        order.item_ids.forEach(item => {
          const coatingAssignments = item.team_assignments?.coating || [];
          const glassAssignments = item.team_assignments?.glass || [];

          coatingAssignments.forEach(coatingItem => {
            const glassItemId = coatingItem.glass_item_id?._id || coatingItem.glass_item_id;
            
            // Find the corresponding glass item
            const glassItem = glassAssignments.find(glass => 
              glass._id?.toString() === glassItemId?.toString()
            );

            if (!glassItem) {
              console.log(`❌ Glass item not found for coating assignment: ${coatingItem._id}`);
              return;
            }

            const decorationType = glassItem.decoration_details?.type || glassItem.decoration;
            
            if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
              console.log(`ℹ️ No decoration sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            const sequence = DECORATION_SEQUENCES[decorationType];
            const coatingIndex = sequence.indexOf('coating');

            // If coating is not in the sequence, skip
            if (coatingIndex === -1) {
              console.log(`ℹ️ Coating not in sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            console.log(`📋 Glass ${glassItem.glass_name} sequence: ${sequence.join(' → ')}`);
            console.log(`📍 Coating position: ${coatingIndex}`);

            // Check if all previous teams in sequence are completed
            let canShowToCoating = true;
            const previousTeams = sequence.slice(0, coatingIndex);

            console.log(`🔍 Checking previous teams: ${previousTeams.join(', ')}`);

            for (const prevTeam of previousTeams) {
              const isCompleted = checkTeamCompletionForGlassItem(
                order, 
                item, 
                prevTeam, 
                glassItemId
              );

              console.log(`📊 ${prevTeam} completion for glass ${glassItem.glass_name}: ${isCompleted ? '✅ COMPLETED' : '❌ PENDING'}`);

              if (!isCompleted) {
                canShowToCoating = false;
                console.log(`⏳ Cannot show to coating - ${prevTeam} not completed for glass ${glassItem.glass_name}`);
                break;
              }
            }

            // Special case: If coating is the first team, check if glass is completed
            if (coatingIndex === 0) {
              const glassCompleted = glassItem.team_tracking?.total_completed_qty >= glassItem.quantity;
              console.log(`🏭 Glass completion check for ${glassItem.glass_name}: ${glassCompleted ? '✅ COMPLETED' : '❌ PENDING'} (${glassItem.team_tracking?.total_completed_qty || 0}/${glassItem.quantity})`);
              
              if (!glassCompleted) {
                canShowToCoating = false;
                console.log(`⏳ Cannot show to coating - glass not completed for ${glassItem.glass_name}`);
              }
            }

            if (canShowToCoating) {
              console.log(`✅ Adding coating item to valid list: ${glassItem.glass_name}`);
              
              // Structure coating item to match expected format
              validCoatingItems.push({
                item: {
                  ...item,
                  team_assignments: { coating: [coatingItem] }
                },
                coatingAssignment: {
                  _id: coatingItem._id, // ✅ Keep the actual database ID
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
                }
              });
            }
          });
        });

        if (validCoatingItems.length === 0) {
          console.log(`❌ No valid coating items for order ${order.order_number}`);
          return null;
        }

        // Group items by item ID and combine coating assignments
        const itemsMap = new Map();
        
        validCoatingItems.forEach(({ item, coatingAssignment }) => {
          const itemId = item._id.toString();
          
          if (!itemsMap.has(itemId)) {
            itemsMap.set(itemId, {
              ...item,
              team_assignments: { coating: [] }
            });
          }
          
          itemsMap.get(itemId).team_assignments.coating.push(coatingAssignment);
        });

        const filteredItems = Array.from(itemsMap.values());

        console.log(`✅ Order ${order.order_number}: ${filteredItems.length} items with valid coating assignments`);

        return {
          ...order,
          item_ids: filteredItems
        };
      })
      .filter(order => order !== null);

    console.log(`📊 Final result: ${filteredOrders.length} orders ready for coating team`);

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

// Helper function to check if a team is completed for a specific glass item
function checkTeamCompletionForGlassItem(order, item, teamName, glassItemId) {
  const teamAssignments = item.team_assignments?.[teamName] || [];

  for (const assignment of teamAssignments) {
    let assignmentGlassId;
    
    // Handle different assignment structures
    if (teamName === 'glass') {
      assignmentGlassId = assignment._id;
    } else {
      assignmentGlassId = assignment.glass_item_id?._id || assignment.glass_item_id;
    }

    if (assignmentGlassId?.toString() === glassItemId?.toString()) {
      const isCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;
      return isCompleted;
    }
  }

  // If no assignment found for this glass item in this team, consider it as not applicable (completed)
  return true;
}

export const updateCoatingTracking = async (req, res, next) => {
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
          // Strategy 1: Direct lookup in CoatingItem collection
          assignment = await CoatingItem.findById(update.assignmentId).session(session);
          console.log('Direct lookup result:', assignment ? 'Found' : 'Not found');
          
          // Strategy 2: If not found, check if it's in the item's team_assignments
          if (!assignment) {
            const coatingAssignmentIds = item.team_assignments?.coating || [];
            console.log('Checking assignment IDs:', coatingAssignmentIds);
            
            // Check if the assignment ID exists in the item's assignments
            const assignmentExists = coatingAssignmentIds.some(
              id => id.toString() === update.assignmentId.toString()
            );
            
            if (assignmentExists) {
              // Try to find it again, maybe it was just created
              assignment = await CoatingItem.findById(update.assignmentId).session(session);
            }
          }
          
          // Strategy 3: If still not found, try to find by glass_item_id and itemId
          if (!assignment) {
            console.log('Attempting to find assignment by glass_item_id and itemId');
            
            // Get all coating assignments for this item
            const allCoatingAssignments = await CoatingItem.find({
              itemId: itemId,
              orderNumber: orderNumber
            }).session(session);
            
            console.log('Found coating assignments for item:', allCoatingAssignments.length);
            
            // Try to match by the assignment ID
            assignment = allCoatingAssignments.find(
              a => a._id.toString() === update.assignmentId.toString()
            );
          }
          
        } catch (lookupError) {
          console.error('Error during assignment lookup:', lookupError);
        }
        
        // ✅ FIXED: If still not found, provide detailed error information
        if (!assignment) {
          console.error('❌ Assignment not found with ID:', update.assignmentId);
          console.error('Available assignment IDs in item:', item.team_assignments?.coating || []);
          
          // Try to get all coating assignments for this order to debug
          const allOrderCoatingAssignments = await CoatingItem.find({
            orderNumber: orderNumber
          }).session(session);
          
          console.error('All coating assignments for order:', allOrderCoatingAssignments.map(a => ({
            id: a._id.toString(),
            itemId: a.itemId,
            glass_name: a.glass_name
          })));
          
          throw new Error(`Coating assignment not found: ${update.assignmentId}. Available assignments: ${allOrderCoatingAssignments.map(a => a._id.toString()).join(', ')}`);
        }

        console.log('✅ Found assignment:', assignment._id.toString());

        // ✅ FIXED: Validate quantity with proper error handling
        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for coating ${assignment.glass_name || 'item'}`
          );
        }

        // ✅ FIXED: Update existing assignment with proper validation
        const updateResult = await CoatingItem.findByIdAndUpdate(
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
          throw new Error(`Failed to update coating assignment: ${assignment._id}`);
        }

        console.log('✅ Successfully updated assignment:', assignment._id.toString());
      }

      // ✅ FIXED: Better completion checking with error handling
      try {
        const itemCompletionResult = await OrderItem.aggregate([
          { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
          {
            $lookup: {
              from: 'coatingitems',
              localField: 'team_assignments.coating',
              foreignField: '_id',
              as: 'coating_assignments'
            }
          },
          {
            $addFields: {
              allCoatingCompleted: {
                $cond: {
                  if: { $gt: [{ $size: '$coating_assignments' }, 0] },
                  then: {
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
                  },
                  else: false
                }
              }
            }
          },
          { $project: { allCoatingCompleted: 1 } }
        ]).session(session);

        if (itemCompletionResult[0]?.allCoatingCompleted) {
          await OrderItem.findByIdAndUpdate(
            itemId,
            { $set: { 'team_status.coating': 'Completed' } },
            { session }
          );

          console.log('✅ Item coating completed');

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
                      from: 'coatingitems',
                      localField: 'team_assignments.coating',
                      foreignField: '_id',
                      as: 'coating_assignments'
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
                          if: { $gt: [{ $size: '$$item.coating_assignments' }, 0] },
                          then: {
                            $allElementsTrue: {
                              $map: {
                                input: '$$item.coating_assignments',
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
      message: 'Coating tracking updated successfully',
      data: {
        order: updatedOrder, // ✅ Send full order (with all team assignments!)
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('❌ Error updating coating tracking:', error);
    
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