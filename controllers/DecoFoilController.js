import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import FoilingItem from '../models/FoilingItem.js';
import mongoose from 'mongoose';
import { updateOrderCompletionStatus } from '../helpers/ordercompletion.js';

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

    const orders = await Order.find(filter)
      .populate({
        path: 'item_ids',
        populate: [
          { path: 'team_assignments.glass', model: 'GlassItem' },
          { path: 'team_assignments.printing', model: 'PrintingItem' },
          { path: 'team_assignments.coating', model: 'CoatingItem' },
          { path: 'team_assignments.foiling', model: 'FoilingItem' },
          { path: 'team_assignments.frosting', model: 'FrostingItem' }
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

            if (foilingIndex === -1) {
              console.log(`ℹ️ Foiling not in sequence for glass ${glassItem.glass_name}, skipping`);
              return;
            }

            console.log(`📋 Glass ${glassItem.glass_name} sequence: ${sequence.join(' → ')}`);
            console.log(`📍 Foiling position: ${foilingIndex}`);

            let canShowToFoiling = true;
            const previousTeams = sequence.slice(0, foilingIndex);

            console.log(`🔍 Checking previous teams: ${previousTeams.join(', ')}`);

            for (const prevTeam of previousTeams) {
              const isCompleted = checkTeamCompletionForGlassItem(order, item, prevTeam, glassItemId);

              console.log(`📊 ${prevTeam} completion for glass ${glassItem.glass_name}: ${isCompleted ? '✅ COMPLETED' : '❌ PENDING'}`);

              if (!isCompleted) {
                canShowToFoiling = false;
                console.log(`⏳ Cannot show to foiling - ${prevTeam} not completed for glass ${glassItem.glass_name}`);
                break;
              }
            }

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

      for (const update of updatesArray) {
        console.log('Processing update for assignmentId:', update.assignmentId);
        
        let assignment = null;
        
        try {
          assignment = await FoilingItem.findById(update.assignmentId).session(session);
          console.log('Direct lookup result:', assignment ? 'Found' : 'Not found');
          
          if (!assignment) {
            const foilingAssignmentIds = item.team_assignments?.foiling || [];
            console.log('Checking assignment IDs:', foilingAssignmentIds);
            
            const assignmentExists = foilingAssignmentIds.some(
              id => id.toString() === update.assignmentId.toString()
            );
            
            if (assignmentExists) {
              assignment = await FoilingItem.findById(update.assignmentId).session(session);
            }
          }
          
          if (!assignment) {
            console.log('Attempting to find assignment by glass_item_id and itemId');
            
            const allFoilingAssignments = await FoilingItem.find({
              itemId: itemId,
              orderNumber: orderNumber
            }).session(session);
            
            console.log('Found foiling assignments for item:', allFoilingAssignments.length);
            
            assignment = allFoilingAssignments.find(
              a => a._id.toString() === update.assignmentId.toString()
            );
          }
          
        } catch (lookupError) {
          console.error('Error during assignment lookup:', lookupError);
        }
        
        if (!assignment) {
          console.error('❌ Assignment not found with ID:', update.assignmentId);
          console.error('Available assignment IDs in item:', item.team_assignments?.foiling || []);
          
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

        const currentCompleted = assignment.team_tracking?.total_completed_qty || 0;
        const remaining = assignment.quantity - currentCompleted;

        if (update.newEntry.quantity > remaining) {
          throw new Error(
            `Quantity ${update.newEntry.quantity} exceeds remaining quantity ${remaining} for foiling ${assignment.glass_name || 'item'}`
          );
        }

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

      await updateOrderCompletionStatus(orderNumber, itemId, 'foiling', session);
    });

    const updatedOrder = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        populate: [
          { path: 'team_assignments.glass', model: 'GlassItem' },
          { path: 'team_assignments.printing', model: 'PrintingItem' },
          { path: 'team_assignments.coating', model: 'CoatingItem' },
          { path: 'team_assignments.foiling', model: 'FoilingItem' },
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
        order: updatedOrder,
        updatedAssignments: isBulkUpdate ? updatedAssignments : updatedAssignments[0]
      }
    });

  } catch (error) {
    console.error('❌ Error updating foiling tracking:', error);
    
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