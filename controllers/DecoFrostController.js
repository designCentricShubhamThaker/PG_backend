import { updateOrderCompletionStatus } from '../helpers/ordercompletion.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import FrostingItem from '../models/FrostingItem.js';
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

export const getFrostOrders = async (req, res, next) => {
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
            path: 'team_assignments.frosting',
            model: 'FrostingItem',
            populate: {
              path: 'glass_item_id',
              model: 'GlassItem'
            }
          },
          { 
            path: 'team_assignments.coating', 
            model: 'CoatingItem' 
          },
          { 
            path: 'team_assignments.printing', 
            model: 'PrintingItem' 
          },
          { 
            path: 'team_assignments.foiling', 
            model: 'FoilingItem' 
          }
        ]
      })
      .lean();

    console.log(`📊 Found ${orders.length} orders, filtering for frosting team with sequence logic`);

    const filteredOrders = orders
      .map(order => {
        console.log(`🔍 Processing order: ${order.order_number}`);
        
        const validFrostingItems = [];

        order.item_ids.forEach(item => {
          const frostingAssignments = item.team_assignments?.frosting || [];
          const glassAssignments = item.team_assignments?.glass || [];

          frostingAssignments.forEach(frostingItem => {
            const glassItemId = frostingItem.glass_item_id?._id || frostingItem.glass_item_id;
            
            // Find the corresponding glass item
            const glassItem = glassAssignments.find(glass => 
              glass._id?.toString() === glassItemId?.toString()
            );

            if (!glassItem) {
              console.log(`❌ Glass item not found for frosting assignment: ${frostingItem._id}`);
              return;
            }

            const decorationType = glassItem.decoration_details?.type || glassItem.decoration;
            
            if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
              console.log(`ℹ️ No decoration sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            const sequence = DECORATION_SEQUENCES[decorationType];
            const frostingIndex = sequence.indexOf('frosting');

            // If frosting is not in the sequence, skip
            if (frostingIndex === -1) {
              console.log(`ℹ️ Frosting not in sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            console.log(`📋 Glass ${glassItem.glass_name} sequence: ${sequence.join(' → ')}`);
            console.log(`📍 Frosting position: ${frostingIndex}`);

            // Check if all previous teams in sequence are completed
            let canShowToFrosting = true;
            const previousTeams = sequence.slice(0, frostingIndex);

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
                canShowToFrosting = false;
                console.log(`⏳ Cannot show to frosting - ${prevTeam} not completed for glass ${glassItem.glass_name}`);
                break;
              }
            }

            // Special case: If frosting is the first team, check if glass is completed
            if (frostingIndex === 0) {
              const glassCompleted = glassItem.team_tracking?.total_completed_qty >= glassItem.quantity;
              console.log(`🏭 Glass completion check for ${glassItem.glass_name}: ${glassCompleted ? '✅ COMPLETED' : '❌ PENDING'} (${glassItem.team_tracking?.total_completed_qty || 0}/${glassItem.quantity})`);
              
              if (!glassCompleted) {
                canShowToFrosting = false;
                console.log(`⏳ Cannot show to frosting - glass not completed for ${glassItem.glass_name}`);
              }
            }

            if (canShowToFrosting) {
              console.log(`✅ Adding frosting item to valid list: ${glassItem.glass_name}`);
              
              // Structure frosting item to match expected format
              validFrostingItems.push({
                item: {
                  ...item,
                  team_assignments: { frosting: [frostingItem] }
                },
                frostingAssignment: {
                  _id: frostingItem._id,
                  itemId: frostingItem.itemId,
                  orderNumber: frostingItem.orderNumber,
                  glass_item_id: glassItem._id,
                  glass_name: glassItem.glass_name,
                  quantity: glassItem.quantity,
                  weight: glassItem.weight,
                  neck_size: glassItem.neck_size,
                  decoration: glassItem.decoration,
                  decoration_no: glassItem.decoration_no,
                  decoration_details: glassItem.decoration_details,
                  team: "Frosting Team",
                  status: frostingItem.status || 'Pending',
                  team_tracking: frostingItem.team_tracking || {
                    total_completed_qty: 0,
                    completed_entries: [],
                    last_updated: null
                  },
                  createdAt: frostingItem.createdAt,
                  updatedAt: frostingItem.updatedAt,
                  __v: frostingItem.__v
                }
              });
            }
          });
        });

        if (validFrostingItems.length === 0) {
          console.log(`❌ No valid frosting items for order ${order.order_number}`);
          return null;
        }

        // Group items by item ID and combine frosting assignments
        const itemsMap = new Map();
        
        validFrostingItems.forEach(({ item, frostingAssignment }) => {
          const itemId = item._id.toString();
          
          if (!itemsMap.has(itemId)) {
            itemsMap.set(itemId, {
              ...item,
              team_assignments: { frosting: [] }
            });
          }
          
          itemsMap.get(itemId).team_assignments.frosting.push(frostingAssignment);
        });

        const filteredItems = Array.from(itemsMap.values());

        console.log(`✅ Order ${order.order_number}: ${filteredItems.length} items with valid frosting assignments`);

        return {
          ...order,
          item_ids: filteredItems
        };
      })
      .filter(order => order !== null);

    console.log(`📊 Final result: ${filteredOrders.length} orders ready for frosting team`);

    res.status(200).json({
      success: true,
      count: filteredOrders.length,
      data: filteredOrders
    });
  } catch (error) {
    console.error('Error fetching frosting orders:', error);
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

export const updateFrostTracking = async (req, res, next) => {
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
          // Strategy 1: Direct lookup in FrostingItem collection
          assignment = await FrostingItem.findById(update.assignmentId).session(session);
          console.log('Direct lookup result:', assignment ? 'Found' : 'Not found');
          
          // Strategy 2: If not found, check if it's in the item's team_assignments
          if (!assignment) {
            const frostingAssignmentIds = item.team_assignments?.frosting || [];
            console.log('Checking assignment IDs:', frostingAssignmentIds);
            
            // Check if the assignment ID exists in the item's assignments
            const assignmentExists = frostingAssignmentIds.some(
              id => id.toString() === update.assignmentId.toString()
            );
            
            if (assignmentExists) {
              // Try to find it again, maybe it was just created
              assignment = await FrostingItem.findById(update.assignmentId).session(session);
            }
          }
          
          // Strategy 3: If still not found, try to find by glass_item_id and itemId
          if (!assignment) {
            console.log('Attempting to find assignment by glass_item_id and itemId');
            
            // Get all frosting assignments for this item
            const allFrostingAssignments = await FrostingItem.find({
              itemId: itemId,
              orderNumber: orderNumber
            }).session(session);
            
            console.log('Found frosting assignments for item:', allFrostingAssignments.length);
            
            // Try to match by the assignment ID
            assignment = allFrostingAssignments.find(
              a => a._id.toString() === update.assignmentId.toString()
            );
          }
          
        } catch (lookupError) {
          console.error('Error during assignment lookup:', lookupError);
        }
        
        // ✅ FIXED: If still not found, provide detailed error information
        if (!assignment) {
          console.error('❌ Assignment not found with ID:', update.assignmentId);
          console.error('Available assignment IDs in item:', item.team_assignments?.frosting || []);
          
          // Try to get all frosting assignments for this order to debug
          const allOrderFrostingAssignments = await FrostingItem.find({
            orderNumber: orderNumber
          }).session(session);
          
          console.error('All frosting assignments for order:', allOrderFrostingAssignments.map(a => ({
            id: a._id.toString(),
            itemId: a.itemId,
            glass_name: a.glass_name
          })));
          
          throw new Error(`Frosting assignment not found: ${update.assignmentId}. Available assignments: ${allOrderFrostingAssignments.map(a => a._id.toString()).join(', ')}`);
        }

        console.log('✅ Found assignment:', assignment._id.toString());

        // ✅ FIXED: Validate quantity with proper error handling
        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for frosting ${assignment.glass_name || 'item'}`
          );
        }

        // ✅ FIXED: Update existing assignment with proper validation
        const updateResult = await FrostingItem.findByIdAndUpdate(
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
          throw new Error(`Failed to update frosting assignment: ${assignment._id}`);
        }

        console.log('✅ Successfully updated assignment:', assignment._id.toString());
      }

      // ✅ SIMPLE FIX: Replace all the complex aggregation logic with one line!
      await updateOrderCompletionStatus(orderNumber, itemId, 'frosting', session);
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
      message: 'Frosting tracking updated successfully',
      data: {
        order: updatedOrder, // ✅ Send full order (with all team assignments!)
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('❌ Error updating frosting tracking:', error);
    
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