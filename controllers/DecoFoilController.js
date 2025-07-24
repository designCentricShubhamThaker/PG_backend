import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import FoilingItem from '../models/FoilingItem.js';
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

export const getFoilOrders = async (req, res, next) => {
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
            path: 'team_assignments.foiling',
            model: 'FoilingItem',
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
            path: 'team_assignments.frosting', 
            model: 'FrostingItem' 
          }
        ]
      })
      .lean();

    console.log(`📊 Found ${orders.length} orders, filtering for foiling team with sequence logic`);

    const filteredOrders = orders
      .map(order => {
        console.log(`🔍 Processing order: ${order.order_number}`);
        
        const validFoilingItems = [];

        order.item_ids.forEach(item => {
          const foilingAssignments = item.team_assignments?.foiling || [];
          const glassAssignments = item.team_assignments?.glass || [];

          foilingAssignments.forEach(foilingItem => {
            const glassItemId = foilingItem.glass_item_id?._id || foilingItem.glass_item_id;
            
            // Find the corresponding glass item
            const glassItem = glassAssignments.find(glass => 
              glass._id?.toString() === glassItemId?.toString()
            );

            if (!glassItem) {
              console.log(`❌ Glass item not found for foiling assignment: ${foilingItem._id}`);
              return;
            }

            const decorationType = glassItem.decoration_details?.type || glassItem.decoration;
            
            if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
              console.log(`ℹ️ No decoration sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            const sequence = DECORATION_SEQUENCES[decorationType];
            const foilingIndex = sequence.indexOf('foiling');

            // If foiling is not in the sequence, skip
            if (foilingIndex === -1) {
              console.log(`ℹ️ Foiling not in sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            console.log(`📋 Glass ${glassItem.glass_name} sequence: ${sequence.join(' → ')}`);
            console.log(`📍 Foiling position: ${foilingIndex}`);

            // Check if all previous teams in sequence are completed
            let canShowToFoiling = true;
            const previousTeams = sequence.slice(0, foilingIndex);

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
                canShowToFoiling = false;
                console.log(`⏳ Cannot show to foiling - ${prevTeam} not completed for glass ${glassItem.glass_name}`);
                break;
              }
            }

            // Special case: If foiling is the first team, check if glass is completed
            if (foilingIndex === 0) {
              const glassCompleted = glassItem.team_tracking?.total_completed_qty >= glassItem.quantity;
              console.log(`🏭 Glass completion check for ${glassItem.glass_name}: ${glassCompleted ? '✅ COMPLETED' : '❌ PENDING'} (${glassItem.team_tracking?.total_completed_qty || 0}/${glassItem.quantity})`);
              
              if (!glassCompleted) {
                canShowToFoiling = false;
                console.log(`⏳ Cannot show to foiling - glass not completed for ${glassItem.glass_name}`);
              }
            }

            if (canShowToFoiling) {
              console.log(`✅ Adding foiling item to valid list: ${glassItem.glass_name}`);
              
              // Structure foiling item to match expected format
              validFoilingItems.push({
                item: {
                  ...item,
                  team_assignments: { foiling: [foilingItem] }
                },
                foilingAssignment: {
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
                }
              });
            }
          });
        });

        if (validFoilingItems.length === 0) {
          console.log(`❌ No valid foiling items for order ${order.order_number}`);
          return null;
        }

        // Group items by item ID and combine foiling assignments
        const itemsMap = new Map();
        
        validFoilingItems.forEach(({ item, foilingAssignment }) => {
          const itemId = item._id.toString();
          
          if (!itemsMap.has(itemId)) {
            itemsMap.set(itemId, {
              ...item,
              team_assignments: { foiling: [] }
            });
          }
          
          itemsMap.get(itemId).team_assignments.foiling.push(foilingAssignment);
        });

        const filteredItems = Array.from(itemsMap.values());

        console.log(`✅ Order ${order.order_number}: ${filteredItems.length} items with valid foiling assignments`);

        return {
          ...order,
          item_ids: filteredItems
        };
      })
      .filter(order => order !== null);

    console.log(`📊 Final result: ${filteredOrders.length} orders ready for foiling team`);

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
          // Strategy 1: Direct lookup in FoilingItem collection
          assignment = await FoilingItem.findById(update.assignmentId).session(session);
          console.log('Direct lookup result:', assignment ? 'Found' : 'Not found');
          
          // Strategy 2: If not found, check if it's in the item's team_assignments
          if (!assignment) {
            const foilingAssignmentIds = item.team_assignments?.foiling || [];
            console.log('Checking assignment IDs:', foilingAssignmentIds);
            
            // Check if the assignment ID exists in the item's assignments
            const assignmentExists = foilingAssignmentIds.some(
              id => id.toString() === update.assignmentId.toString()
            );
            
            if (assignmentExists) {
              // Try to find it again, maybe it was just created
              assignment = await FoilingItem.findById(update.assignmentId).session(session);
            }
          }
          
          // Strategy 3: If still not found, try to find by glass_item_id and itemId
          if (!assignment) {
            console.log('Attempting to find assignment by glass_item_id and itemId');
            
            // Get all foiling assignments for this item
            const allFoilingAssignments = await FoilingItem.find({
              itemId: itemId,
              orderNumber: orderNumber
            }).session(session);
            
            console.log('Found foiling assignments for item:', allFoilingAssignments.length);
            
            // Try to match by the assignment ID
            assignment = allFoilingAssignments.find(
              a => a._id.toString() === update.assignmentId.toString()
            );
          }
          
        } catch (lookupError) {
          console.error('Error during assignment lookup:', lookupError);
        }
        
        // ✅ FIXED: If still not found, provide detailed error information
        if (!assignment) {
          console.error('❌ Assignment not found with ID:', update.assignmentId);
          console.error('Available assignment IDs in item:', item.team_assignments?.foiling || []);
          
          // Try to get all foiling assignments for this order to debug
          const allOrderFoilingAssignments = await FoilingItem.find({
            orderNumber: orderNumber
          }).session(session);
          
          console.error('All foiling assignments for order:', allOrderFoilingAssignments.map(a => ({
            id: a._id.toString(),
            itemId: a.itemId,
            glass_name: a.glass_name
          })));
          
          throw new Error(`Foiling assignment not found: ${update.assignmentId}. Available assignments: ${allOrderFoilingAssignments.map(a => a._id.toString()).join(', ')}`);
        }

        console.log('✅ Found assignment:', assignment._id.toString());

        // ✅ FIXED: Validate quantity with proper error handling
        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for foiling ${assignment.glass_name || 'item'}`
          );
        }

        // ✅ FIXED: Update existing assignment with proper validation
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

        console.log('✅ Successfully updated assignment:', assignment._id.toString());
      }

      // ✅ CRITICAL FIX: Better completion checking with proper null/undefined handling
      try {
        // Check if all foiling assignments for this item are completed
        const allFoilingAssignments = await FoilingItem.find({
          itemId: itemId,
          orderNumber: orderNumber
        }).session(session);

        console.log('📊 Checking completion for foiling assignments:', allFoilingAssignments.length);

        let allFoilingCompleted = false;
        
        if (allFoilingAssignments.length > 0) {
          allFoilingCompleted = allFoilingAssignments.every(assignment => {
            const completedQty = assignment.team_tracking?.total_completed_qty || 0;
            const totalQty = assignment.quantity || 0;
            const isCompleted = completedQty >= totalQty;
            
            console.log(`📋 Assignment ${assignment._id}: ${completedQty}/${totalQty} = ${isCompleted ? 'COMPLETED' : 'PENDING'}`);
            
            return isCompleted;
          });
        }

        console.log('📊 All foiling assignments completed:', allFoilingCompleted);

        if (allFoilingCompleted) {
          await OrderItem.findByIdAndUpdate(
            itemId,
            { $set: { 'team_status.foiling': 'Completed' } },
            { session }
          );

          console.log('✅ Item foiling completed');

          // ✅ FIXED: Check if entire order is completed - simpler approach
          const orderItems = await OrderItem.find({
            _id: { $in: await Order.findOne({ order_number: orderNumber }).select('item_ids').then(o => o?.item_ids || []) }
          }).session(session);

          console.log('📊 Checking order completion - total items:', orderItems.length);

          let allItemsCompleted = true;

          for (const orderItem of orderItems) {
            // Get all foiling assignments for this item
            const itemFoilingAssignments = await FoilingItem.find({
              itemId: orderItem._id,
              orderNumber: orderNumber
            }).session(session);

            if (itemFoilingAssignments.length > 0) {
              const itemFoilingCompleted = itemFoilingAssignments.every(assignment => {
                const completedQty = assignment.team_tracking?.total_completed_qty || 0;
                const totalQty = assignment.quantity || 0;
                return completedQty >= totalQty;
              });

              if (!itemFoilingCompleted) {
                allItemsCompleted = false;
                console.log(`📋 Item ${orderItem._id} foiling not completed`);
                break;
              }
            }
          }

          console.log('📊 All order items foiling completed:', allItemsCompleted);

          if (allItemsCompleted) {
            const currentOrder = await Order.findOne({ order_number: orderNumber }).session(session);
            
            if (currentOrder && currentOrder.order_status !== 'Completed') {
              await Order.findOneAndUpdate(
                { order_number: orderNumber },
                { $set: { order_status: 'Completed' } },
                { session }
              );
              console.log('✅ Order completed');
            }
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
      message: 'Foiling tracking updated successfully',
      data: {
        order: updatedOrder, // ✅ Send full order (with all team assignments!)
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('❌ Error updating foiling tracking:', error);
    
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