import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import './config/db.js';
import routes from './routes/index.js';

dotenv.config();

const app = express();
app.use(express.json());

const httpServer = createServer(app);

app.use(cors({
  origin: '*',
  credentials: true
}));

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const connectedUsers = new Map();
const teamMembers = {
  dispatchers: new Set(),
  glass: new Set(),
  caps: new Set(),
  boxes: new Set(),
  pumps: new Set(),
  printing: new Set(),
  coating: new Set(),
  foiling: new Set(),
  frosting: new Set()
};

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

const processedItems = new Map();

app.use('/api', routes);

app.get('/', (req, res) => {
  res.send('Pragati Glass Order Management API is Running!');
});

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  const { userId, role, team } = socket.handshake.query;
  if (userId && role) {
    const userInfo = {
      socketId: socket.id,
      userId,
      role,
      team: team?.toLowerCase().trim(),
      connected: true
    };

    connectedUsers.set(socket.id, userInfo);
    addUserToTeams(socket, userInfo);
    broadcastConnectedUsers();
  }

  socket.on('register', (userData) => {
    const { userId, role, team } = userData;
    const userInfo = {
      socketId: socket.id,
      userId: userId || socket.id,
      role,
      team: team?.toLowerCase().trim(),
      connected: true
    };

    removeUserFromTeams(socket.id);
    connectedUsers.set(socket.id, userInfo);
    addUserToTeams(socket, userInfo);

    socket.emit('registered', { success: true, user: userInfo });
    broadcastConnectedUsers();
  });

  socket.on('new-order-created', (orderData) => {
    console.log('📦 New order notification received:', orderData.orderNumber);

    try {
      const { order, assignedTeams, dispatcherName, customerName, orderNumber, timestamp } = orderData;

      const baseNotification = {
        type: 'new-order',
        orderNumber,
        customerName,
        dispatcherName,
        timestamp,
        message: `New order #${orderNumber} created for ${customerName}`
      };

      // Send to dispatchers
      io.to('dispatchers').emit('new-order', {
        ...baseNotification,
        orderData: order
      });

      // Send to non-decoration teams (glass, caps, boxes, pumps) immediately
      const nonDecorationTeams = ['glass', 'caps', 'boxes', 'pumps'];

      assignedTeams.forEach(teamName => {
        if (nonDecorationTeams.includes(teamName) && teamMembers[teamName] && teamMembers[teamName].size > 0) {
          const filteredOrder = filterOrderForTeam(order, teamName);

          io.to(teamName).emit('new-order', {
            ...baseNotification,
            message: `New order #${orderNumber} assigned to ${teamName.toUpperCase()} team`,
            orderData: filteredOrder
          });

          console.log(`📤 Order sent to ${teamName} team immediately`);
        }
      });

      // Clear processed items for new order
      processedItems.clear();
      console.log(`📋 Decoration teams will receive order sequentially based on glass completion`);

    } catch (error) {
      console.error('Error handling order notification:', error);
    }
  });

  socket.on('team-progress-updated', (progressData) => {
    console.log('📈 Team progress update received:', {
      order: progressData.orderNumber,
      team: progressData.team,
      item: progressData.itemName
    });

    try {
      const {
        orderNumber,
        itemName,
        team,
        updates,
        updatedOrder,
        customerName,
        dispatcherName,
        timestamp
      } = progressData;

      let processedOrder;
      if (typeof updatedOrder === 'string') {
        try {
          processedOrder = JSON.parse(updatedOrder);
        } catch (parseError) {
          console.error('Error parsing updatedOrder:', parseError);
          processedOrder = updatedOrder;
        }
      } else {
        processedOrder = updatedOrder;
      }

      if (!processedOrder || !processedOrder.item_ids || !Array.isArray(processedOrder.item_ids)) {
        console.error('❌ Invalid order structure received:', processedOrder);
        return;
      }

      const hasValidItems = processedOrder.item_ids.some(item =>
        item.team_assignments &&
        item.team_assignments.glass &&
        Array.isArray(item.team_assignments.glass) &&
        item.team_assignments.glass.length > 0
      );

      if (!hasValidItems) {
        console.error('❌ Order missing glass assignments - this is required for decoration sequence');
        return;
      }

      // ✅ CRITICAL FIX: Extract the specific glass item ID from the updated assignment
      const glassItemId = extractGlassItemIdFromUpdates(processedOrder, team.toLowerCase(), updates);
      console.log(`🔍 Extracted glass item ID from updates: ${glassItemId}`);

      // ✅ CRITICAL FIX: Only filter for decoration teams with valid glass item ID
      const isDecorationTeam = ['printing', 'coating', 'foiling', 'frosting'].includes(team.toLowerCase());
      const filteredOrder = isDecorationTeam && glassItemId
        ? filterOrderForDecorationTeam(processedOrder, team.toLowerCase(), glassItemId)
        : processedOrder;

      const notificationData = {
        type: 'team-progress-update',
        orderNumber,
        itemName,
        team: team.toUpperCase(),
        customerName,
        dispatcherName,
        timestamp,
        updates,
        orderData: filteredOrder,
        message: `${team.toUpperCase()} team updated progress for ${itemName} in order #${orderNumber}`
      };

      io.to('dispatchers').emit('team-progress-updated', notificationData);
      socket.broadcast.emit('team-progress-updated', notificationData);

      if (team.toLowerCase() === 'glass') {
        console.log('🔄 Glass team completion detected, checking decoration sequence...');
        checkAndTriggerDecorationSequence(filteredOrder, orderNumber, customerName, dispatcherName);
      }

      if (isDecorationTeam && glassItemId) {
        console.log(`🔄 ${team} team completion detected, checking next decoration team...`);
        checkAndTriggerNextDecorationTeam(filteredOrder, orderNumber, customerName, dispatcherName, team.toLowerCase(), glassItemId);
      }

      console.log(`📤 Progress update sent to dispatchers for order #${orderNumber}`);

    } catch (error) {
      console.error('Error handling team progress update:', error);
      console.error('Progress data received:', progressData);
    }
  });

 function extractGlassItemIdFromUpdates(order, teamName, updates) {
  console.log(`🔍 Extracting glass item ID from ${teamName} updates:`, updates);

  // Handle both array and single object formats
  let updatesArray = Array.isArray(updates) ? updates : [updates];
  
  if (!updatesArray || updatesArray.length === 0) {
    console.log('❌ No updates found');
    return null;
  }

  // Get the first update (assuming single assignment update)
  const firstUpdate = updatesArray[0];
  
  if (!firstUpdate || !firstUpdate.assignmentId) {
    console.log('❌ No assignment ID found in updates');
    return null;
  }

  const assignmentId = firstUpdate.assignmentId;
  console.log(`🔍 Looking for assignment ID: ${assignmentId}`);

  // Search through all items to find the assignment that was updated
  for (const item of order.item_ids || []) {
    const teamAssignments = item.team_assignments?.[teamName] || [];

    for (const assignment of teamAssignments) {
      // Check if this is the assignment that was updated
      if (assignment._id?.toString() === assignmentId.toString()) {
        console.log(`✅ Found updated assignment: ${assignmentId} with glass_item_id: ${assignment.glass_item_id}`);
        return assignment.glass_item_id;
      }
    }
  }

  console.log(`❌ Assignment ${assignmentId} not found in ${teamName} assignments`);
  return null;
}

  function checkAndTriggerDecorationSequence(order, orderNumber, customerName, dispatcherName) {
    console.log('🔍 Checking decoration sequence for completed glass items...');
    order.item_ids?.forEach(item => {
      const glassAssignments = item.team_assignments?.glass || [];

      glassAssignments.forEach(glass => {
        // Check if glass is completed (total_completed_qty >= quantity)
        if (glass.team_tracking?.total_completed_qty >= glass.quantity) {
          const decorationType = glass.decoration_details?.type || glass.decoration;

          if (decorationType && DECORATION_SEQUENCES[decorationType]) {
            const sequence = DECORATION_SEQUENCES[decorationType];

            // CRITICAL FIX: Find the FIRST team in sequence that hasn't been completed yet
            const nextTeamInSequence = findNextTeamInSequence(order, glass._id, sequence);

            if (nextTeamInSequence) {
              console.log(`🎯 Glass ${glass.glass_name} completed, next team in ${decorationType} sequence: ${nextTeamInSequence}`);
              sendToDecorationTeam(order, orderNumber, customerName, dispatcherName, nextTeamInSequence, glass._id);
            } else {
              console.log(`✅ All decoration steps completed for glass ${glass.glass_name}`);
            }
          }
        }
      });
    });
  }

  function checkAndTriggerNextDecorationTeam(order, orderNumber, customerName, dispatcherName, completedTeam, completedGlassItemId) {
    console.log(`🔍 Checking next decoration team after ${completedTeam} completion for glass item ${completedGlassItemId}...`);

    if (!completedGlassItemId) {
      console.log('❌ No glass item ID provided - cannot determine next decoration team');
      return;
    }

    // ✅ CRITICAL FIX: Only check the specific glass item that was completed
    const glassEntry = findGlassEntry(order.item_ids, completedGlassItemId);
    if (!glassEntry) {
      console.log(`❌ Glass item ${completedGlassItemId} not found in order`);
      return;
    }

    // ✅ CRITICAL FIX: Verify the glass item itself is completed
    const glassCompleted = glassEntry.team_tracking?.total_completed_qty >= glassEntry.quantity;
    if (!glassCompleted) {
      console.log(`❌ Glass item ${completedGlassItemId} is not completed yet - cannot proceed to next decoration team`);
      return;
    }

    // ✅ CRITICAL FIX: Find the specific decoration assignment that was completed
    let completedAssignment = null;
    for (const item of order.item_ids || []) {
      const teamAssignments = item.team_assignments?.[completedTeam] || [];

      for (const assignment of teamAssignments) {
        if (assignment.glass_item_id?.toString() === completedGlassItemId.toString()) {
          // Check if this decoration assignment is completed
          const isCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;
          if (isCompleted) {
            completedAssignment = assignment;
            console.log(`✅ Found completed ${completedTeam} assignment for glass ${completedGlassItemId}`);
            break;
          } else {
            console.log(`⏳ ${completedTeam} assignment for glass ${completedGlassItemId} is not completed yet: ${assignment.team_tracking?.total_completed_qty || 0}/${assignment.quantity}`);
            return; // Exit early if decoration is not completed
          }
        }
      }

      if (completedAssignment) break;
    }

    if (!completedAssignment) {
      console.log(`❌ No completed ${completedTeam} assignment found for glass ${completedGlassItemId}`);
      return;
    }

    // Get decoration type from the glass item
    const decorationType = glassEntry.decoration_details?.type || glassEntry.decoration;

    if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
      console.log(`❌ No decoration sequence found for type: ${decorationType}`);
      return;
    }

    const sequence = DECORATION_SEQUENCES[decorationType];
    console.log(`🔍 Checking sequence [${sequence.join(' → ')}] for completed ${completedTeam} team`);

    // ✅ CRITICAL FIX: Find the NEXT team in sequence after the completed team
    const nextTeamInSequence = findNextTeamInSequence(order, completedGlassItemId, sequence);

    if (nextTeamInSequence) {
      console.log(`🎯 ${completedTeam} completed for glass ${glassEntry.glass_name}, sending to next team: ${nextTeamInSequence}`);
      sendToDecorationTeam(order, orderNumber, customerName, dispatcherName, nextTeamInSequence, completedGlassItemId);
    } else {
      console.log(`✅ All decoration steps completed for glass ${glassEntry.glass_name}`);
    }
  }

  function isDecorationTeamCompletedForGlass(order, glassItemId, teamName) {
    console.log(`🔍 Checking if ${teamName} is completed for glass ${glassItemId}`);

    for (const item of order.item_ids || []) {
      const teamAssignments = item.team_assignments?.[teamName] || [];

      for (const assignment of teamAssignments) {
        // Check if this assignment is for the specific glass item
        if (assignment.glass_item_id?.toString() === glassItemId?.toString()) {
          const isCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;
          console.log(`📊 ${teamName} assignment for glass ${glassItemId}: ${assignment.team_tracking?.total_completed_qty || 0}/${assignment.quantity} = ${isCompleted ? 'COMPLETED' : 'INCOMPLETE'}`);

          // ✅ CRITICAL FIX: Also verify that the glass item itself is completed
          const glassEntry = findGlassEntry(order.item_ids, glassItemId);
          if (glassEntry) {
            const glassCompleted = glassEntry.team_tracking?.total_completed_qty >= glassEntry.quantity;
            console.log(`🔍 Glass ${glassItemId} completion: ${glassEntry.team_tracking?.total_completed_qty || 0}/${glassEntry.quantity} = ${glassCompleted ? 'COMPLETED' : 'INCOMPLETE'}`);

            // Both decoration and glass must be completed
            return isCompleted && glassCompleted;
          }

          return isCompleted;
        }
      }
    }

    // If no assignment found for this team and glass, consider it as "not started" (not completed)
    console.log(`❌ No ${teamName} assignment found for glass ${glassItemId} - considering as not completed`);
    return false;
  }

  function findNextTeamInSequence(order, glassItemId, sequence) {
    console.log(`🔍 Finding next team in sequence [${sequence.join(' → ')}] for glass ${glassItemId}`);

    // Check each team in the sequence to find the first one that's not completed
    for (const teamName of sequence) {
      console.log(`🔍 Checking if ${teamName} is completed for glass ${glassItemId}...`);

      const isTeamCompleted = isDecorationTeamCompletedForGlass(order, glassItemId, teamName);

      if (!isTeamCompleted) {
        console.log(`✅ Found next team in sequence: ${teamName} (not completed yet)`);
        return teamName;
      } else {
        console.log(`⏭️ ${teamName} already completed, checking next in sequence`);
      }
    }

    console.log(`✅ All teams in sequence completed for glass ${glassItemId}`);
    return null;
  }

  function isDecorationTeamCompletedForGlass(order, glassItemId, teamName) {
    console.log(`🔍 Checking if ${teamName} is completed for glass ${glassItemId}`);

    for (const item of order.item_ids || []) {
      const teamAssignments = item.team_assignments?.[teamName] || [];

      for (const assignment of teamAssignments) {
        // Check if this assignment is for the specific glass item
        if (assignment.glass_item_id?.toString() === glassItemId?.toString()) {
          const isCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;
          console.log(`📊 ${teamName} assignment for glass ${glassItemId}: ${assignment.team_tracking?.total_completed_qty || 0}/${assignment.quantity} = ${isCompleted ? 'COMPLETED' : 'INCOMPLETE'}`);
          return isCompleted;
        }
      }
    }

    // If no assignment found for this team and glass, consider it as "not started" (not completed)
    console.log(`❌ No ${teamName} assignment found for glass ${glassItemId} - considering as not completed`);
    return false;
  }

  function sendToDecorationTeam(order, orderNumber, customerName, dispatcherName, teamName, glassItemId) {
    console.log(`\n🔄 SENDING TO DECORATION TEAM: ${teamName} for glass item ${glassItemId}`);
    console.log(`👥 ${teamName} team members connected: ${teamMembers[teamName]?.size || 0}`);

    if (!teamMembers[teamName] || teamMembers[teamName].size === 0) {
      console.log(`⚠️ No ${teamName} team members connected - cannot send order`);
      return;
    }

    // Filter order to only include items for this team and specific glass
    const filteredOrder = filterOrderForDecorationTeam(order, teamName, glassItemId);

    console.log(`📋 Filtered order summary:`, {
      totalItems: filteredOrder.item_ids.length,
      orderNumber: orderNumber,
      targetGlassItem: glassItemId
    });

    if (filteredOrder.item_ids.length === 0) {
      console.log(`❌ No items found for ${teamName} team with completed glass item ${glassItemId}`);
      return;
    }

    // ENHANCED VALIDATION: Double-check before sending
    const isValidOrder = validateOrderForDecorationTeam(filteredOrder, teamName, glassItemId);
    if (!isValidOrder) {
      console.log(`❌ Order validation failed for ${teamName} team with glass item ${glassItemId}`);
      return;
    }

    const notification = {
      type: 'decoration-sequence',
      orderNumber,
      customerName,
      dispatcherName,
      timestamp: new Date().toISOString(),
      message: `Order #${orderNumber} ready for ${teamName.toUpperCase()} team`,
      orderData: filteredOrder,
      targetGlassItem: glassItemId
    };


    io.to(teamName).emit('new-order', notification);
    console.log(`✅ Order successfully sent to ${teamName} team for glass item ${glassItemId}`);
  }

  function filterOrderForDecorationTeam(order, teamName, glassItemId) {
  console.log(`🔍 FILTERING START: team=${teamName}, targetGlassItem=${glassItemId}`);

  // FIRST: Verify that the specified glass item is actually completed
  const glassEntry = findGlassEntry(order.item_ids, glassItemId);
  if (!glassEntry) {
    console.log(`❌ Glass item ${glassItemId} not found in order`);
    return { ...order, item_ids: [] };
  }

  // Check if this glass item is completed
  const glassCompleted = glassEntry.team_tracking?.total_completed_qty >= glassEntry.quantity;
  if (!glassCompleted) {
    console.log(`❌ Glass item ${glassItemId} (${glassEntry.glass_name}) is not completed yet`);
    console.log(`   Completed: ${glassEntry.team_tracking?.total_completed_qty || 0}, Required: ${glassEntry.quantity}`);
    return { ...order, item_ids: [] };
  }

  console.log(`✅ Target glass item ${glassItemId} (${glassEntry.glass_name}) is completed`);

  const filteredItems = order.item_ids?.map(item => {
    console.log(`\n📦 Processing item: ${item.name}`);

    const teamAssignments = item.team_assignments?.[teamName] || [];
    console.log(`📋 ${teamName} assignments for item ${item.name}: ${teamAssignments.length} total`);

    // Filter assignments for specific glass item AND verify glass completion
    const filteredAssignments = teamAssignments.filter(assignment => {
      console.log(`\n🔍 Checking assignment:`, {
        glass_item_id: assignment.glass_item_id,
        decoration_quantity: assignment.quantity,
        type: typeof assignment
      });

      // Skip invalid assignments
      if (!assignment || typeof assignment !== 'object' || typeof assignment === 'string') {
        console.log(`⚠️ Invalid assignment (skipping):`, assignment);
        return false;
      }

      // ✅ CRITICAL FIX: Only include assignments that match the specific completed glass item
      const matchesGlassItem = assignment.glass_item_id?.toString() === glassItemId?.toString();
      console.log(`🎯 Does assignment match target glass? ${assignment.glass_item_id} === ${glassItemId} = ${matchesGlassItem}`);

      if (!matchesGlassItem) {
        console.log(`❌ Assignment glass_item_id (${assignment.glass_item_id}) does not match target (${glassItemId}) - EXCLUDING`);
        return false;
      }

      // ✅ ADDITIONAL FIX: Double-check that the glass item for this assignment is completed
      const assignmentGlassEntry = findGlassEntry(order.item_ids, assignment.glass_item_id);
      if (!assignmentGlassEntry) {
        console.log(`❌ Glass entry not found for assignment glass_item_id: ${assignment.glass_item_id}`);
        return false;
      }

      const isGlassCompleted = assignmentGlassEntry.team_tracking?.total_completed_qty >= assignmentGlassEntry.quantity;
      console.log(`🔍 Glass ${assignmentGlassEntry.glass_name} completion check:`, {
        completed: assignmentGlassEntry.team_tracking?.total_completed_qty || 0,
        required: assignmentGlassEntry.quantity,
        isCompleted: isGlassCompleted
      });

      if (!isGlassCompleted) {
        console.log(`❌ Glass ${assignmentGlassEntry.glass_name} is not completed, excluding decoration assignment`);
        return false;
      }

      // ✅ CRITICAL FIX: Also check if this decoration assignment is already completed
      const decorationCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;
      if (decorationCompleted) {
        console.log(`⏭️ Decoration assignment already completed for glass ${assignmentGlassEntry.glass_name}`);
        return false;
      }

      console.log(`✅ Assignment VALID for completed glass ${assignmentGlassEntry.glass_name}`);
      return true;
    });

    console.log(`📊 Item ${item.name} valid assignments: ${filteredAssignments.length}/${teamAssignments.length}`);

    // Only include item if it has valid assignments
    if (filteredAssignments.length > 0) {
      const enrichedAssignments = filteredAssignments.map(assignment => {
        const glassEntry = findGlassEntry(order.item_ids, assignment.glass_item_id);
        return {
          ...assignment,
          decoration_quantity: assignment.quantity,
          quantity: assignment.quantity,
          glass_info: {
            glass_name: glassEntry?.glass_name,
            glass_quantity: glassEntry?.quantity,
            weight: glassEntry?.weight,
            neck_size: glassEntry?.neck_size,
            decoration_details: glassEntry?.decoration_details,
            glass_tracking: glassEntry?.team_tracking
          },
          team_tracking: assignment.team_tracking || { total_completed_qty: 0 },
          ready_for_decoration: true
        };
      });

      console.log(`✅ INCLUDING item ${item.name} with ${enrichedAssignments.length} valid assignments`);
      return {
        ...item,
        team_assignments: {
          glass: (item.team_assignments?.glass || []).filter(glass => {
            const isCompleted = glass.team_tracking?.total_completed_qty >= glass.quantity;
            return isCompleted;
          }),
          [teamName]: enrichedAssignments
        }
      };
    }

    console.log(`❌ EXCLUDING item ${item.name} - no valid assignments found`);
    return null;
  }).filter(item => item !== null) || [];

  console.log(`\n📊 FILTERING RESULT: ${filteredItems.length} items will be sent to ${teamName} team`);

  // ✅ ADDITIONAL DEBUG: Log exactly what's being included
  filteredItems.forEach(item => {
    console.log(`📦 Final item: ${item.name} with ${item.team_assignments[teamName]?.length} assignments`);
    item.team_assignments[teamName]?.forEach((assignment, index) => {
      console.log(`   Assignment ${index + 1}: glass_item_id=${assignment.glass_item_id}, glass_name=${assignment.glass_info?.glass_name}, decoration_qty=${assignment.decoration_quantity}, completed=${assignment.team_tracking?.total_completed_qty || 0}`);
    });
  });

  return {
    ...order,
    item_ids: filteredItems
  };
}

  function validateOrderForDecorationTeam(order, teamName, glassItemId) {
    console.log(`🔍 VALIDATING ORDER for ${teamName} team with glass item ${glassItemId}`);

    if (!glassItemId) {
      console.log('❌ No glass item ID provided for validation');
      return false;
    }

    // ✅ CRITICAL FIX: First verify the glass item is completed
    const glassEntry = findGlassEntry(order.item_ids, glassItemId);
    if (!glassEntry) {
      console.log(`❌ Glass item ${glassItemId} not found in order`);
      return false;
    }

    const glassCompleted = glassEntry.team_tracking?.total_completed_qty >= glassEntry.quantity;
    if (!glassCompleted) {
      console.log(`❌ Glass item ${glassItemId} is not completed yet - cannot validate decoration assignments`);
      return false;
    }

    let hasValidAssignments = false;
    let totalValidAssignments = 0;

    order.item_ids?.forEach(item => {
      const assignments = item.team_assignments?.[teamName] || [];
      assignments.forEach(assignment => {
        if (assignment.glass_item_id?.toString() === glassItemId?.toString()) {
          // Check if assignment has valid decoration quantity
          const hasValidQuantity = assignment.decoration_quantity > 0 || assignment.quantity > 0;

          // ✅ CRITICAL FIX: Also check if decoration assignment is not already completed
          const decorationCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;

          if (hasValidQuantity && !decorationCompleted) {
            hasValidAssignments = true;
            totalValidAssignments++;
            console.log(`✅ Valid assignment found: ${assignment.glass_info?.glass_name || glassEntry.glass_name} for ${teamName} with qty: ${assignment.decoration_quantity || assignment.quantity} (not completed)`);
          } else if (decorationCompleted) {
            console.log(`⏭️ Assignment already completed: ${assignment.glass_info?.glass_name || glassEntry.glass_name} for ${teamName}`);
          }
        }
      });
    });

    console.log(`📊 Validation result: ${totalValidAssignments} valid assignments found`);
    return hasValidAssignments;
  }

  function findGlassEntry(itemIds, glassItemId) {
    if (!itemIds || !glassItemId) {
      console.log(`❌ findGlassEntry: Invalid parameters - itemIds=${!!itemIds}, glassItemId=${glassItemId}`);
      return null;
    }
    console.log(`🔍 Looking for glass item ${glassItemId} in ${itemIds.length} items`);
    for (const item of itemIds) {
      const glassAssignments = item.team_assignments?.glass || [];
      console.log(`📋 Item ${item.name} has ${glassAssignments.length} glass assignments`);

      const glassEntry = glassAssignments.find(glass => {
        const match = glass._id?.toString() === glassItemId.toString();
        if (match) {
          console.log(`✅ Found matching glass: ${glass.glass_name} (${glass._id})`);
        }
        return match;
      });

      if (glassEntry) {
        return glassEntry;
      }
    }

    console.log(`❌ Glass item ${glassItemId} not found in any item`);
    return null;
  }

  function filterOrderForTeam(order, teamName) {
    const isDecorationTeam = ['printing', 'coating', 'foiling', 'frosting'].includes(teamName);

    return {
      ...order,
      item_ids: order.item_ids?.map(item => {
        const assignment = item.team_assignments?.[teamName] || [];

        if (isDecorationTeam && assignment.length > 0) {
          // FIXED: Don't overwrite decoration quantities
          const enrichedAssignments = assignment.map(deco => {
            const glassEntry = findGlassEntry(order.item_ids, deco.glass_item_id);
            return {
              ...deco,
              // Keep original decoration quantity
              decoration_quantity: deco.quantity,
              quantity: deco.quantity, // Keep decoration quantity for team work
              // Add glass info separately
              glass_info: {
                glass_name: glassEntry?.glass_name,
                glass_quantity: glassEntry?.quantity,
                weight: glassEntry?.weight,
                neck_size: glassEntry?.neck_size,
                decoration_details: glassEntry?.decoration_details,
                glass_tracking: glassEntry?.team_tracking
              },
              // Use decoration assignment's own tracking
              team_tracking: deco.team_tracking || { total_completed_qty: 0 }
            };
          });

          return {
            ...item,
            team_assignments: {
              glass: item.team_assignments?.glass || [],
              [teamName]: enrichedAssignments
            }
          };
        }

        return {
          ...item,
          team_assignments: {
            glass: item.team_assignments?.glass || [],
            [teamName]: assignment
          }
        };
      }).filter(item => item.team_assignments[teamName]?.length > 0) || []
    };
  }

  socket.on('order-edited', (editData) => {
    console.log('✏️ Order edit notification received:', editData.orderNumber);

    try {
      const {
        order,
        assignedTeams,
        dispatcherName,
        customerName,
        orderNumber,
        timestamp,
        editedFields,
        previousAssignedTeams = []
      } = editData;

      const baseNotification = {
        type: 'order-edited',
        orderNumber,
        customerName,
        dispatcherName,
        timestamp,
        editedFields,
        message: `Order #${orderNumber} has been updated`
      };

      io.to('dispatchers').emit('order-updated', {
        ...baseNotification,
        orderData: order
      });

      const allAffectedTeams = new Set([...assignedTeams, ...previousAssignedTeams]);

      allAffectedTeams.forEach(teamName => {
        if (teamMembers[teamName] && teamMembers[teamName].size > 0) {
          const filteredOrder = filterOrderForTeam(order, teamName);
          const hasCurrentAssignments = assignedTeams.includes(teamName);

          io.to(teamName).emit('order-updated', {
            ...baseNotification,
            message: hasCurrentAssignments
              ? `Order #${orderNumber} assigned to ${teamName.toUpperCase()} team has been updated`
              : `Order #${orderNumber} no longer assigned to ${teamName.toUpperCase()} team`,
            orderData: filteredOrder,
            hasAssignments: hasCurrentAssignments,
            wasRemoved: !hasCurrentAssignments && previousAssignedTeams.includes(teamName)

          });

          console.log(`📤 Updated order sent to ${teamName} team`);
        }
      });

    } catch (error) {
      console.error('Error handling order edit notification:', error);
    }
  });

  socket.on('order-deleted', (deleteData) => {
    console.log('🗑️ Order delete notification received:', deleteData.orderNumber);

    try {
      const {
        orderId,
        orderNumber,
        customerName,
        dispatcherName,
        timestamp,
        assignedTeams = []
      } = deleteData;

      const baseNotification = {
        type: 'order-deleted',
        orderId,
        orderNumber,
        customerName,
        dispatcherName,
        timestamp,
        message: `Order #${orderNumber} has been deleted`
      };

      io.to('dispatchers').emit('order-deleted', {
        ...baseNotification
      });

      assignedTeams.forEach(teamName => {
        if (teamMembers[teamName] && teamMembers[teamName].size > 0) {
          io.to(teamName).emit('order-deleted', {
            ...baseNotification,
            message: `Order #${orderNumber} assigned to ${teamName.toUpperCase()} team has been deleted`
          });

          console.log(`📤 Delete notification sent to ${teamName} team`);
        }
      });

    } catch (error) {
      console.error('Error handling order delete notification:', error);
    }
  });

  function addUserToTeams(socket, userInfo) {
    const { role, team } = userInfo;

    if (role === 'admin' || role === 'dispatcher') {
      teamMembers.dispatchers.add(socket.id);
      socket.join('dispatchers');
      console.log(`🔌 Admin/Dispatcher joined dispatchers room: ${socket.id}`);
    }

    if (team && teamMembers[team]) {
      teamMembers[team].add(socket.id);
      socket.join(team);
      console.log(`🔌 User joined ${team} room`);
    }
  }

  function removeUserFromTeams(socketId) {
    Object.values(teamMembers).forEach(team => team.delete(socketId));
  }


  function broadcastConnectedUsers() {
    const dispatchersList = Array.from(teamMembers.dispatchers).map(socketId => {
      const user = connectedUsers.get(socketId);
      return {
        userId: user?.userId || socketId,
        connected: true
      };
    });

    const teamLists = {};
    const allTeamMembers = [];

    ['glass', 'caps', 'boxes', 'pumps', 'printing', 'coating', 'foiling', 'frosting'].forEach(teamName => {
      const teamUsers = Array.from(teamMembers[teamName]).map(socketId => {
        const user = connectedUsers.get(socketId);
        return {
          userId: user?.userId || socketId,
          team: teamName,
          connected: true
        };
      });

      teamLists[teamName] = teamUsers;
      allTeamMembers.push(...teamUsers);
    });

    io.to('dispatchers').emit('connected-users', {
      dispatchers: dispatchersList,
      teamMembers: allTeamMembers,
      teams: teamLists
    });

    Object.keys(teamLists).forEach(teamName => {
      if (teamMembers[teamName].size > 0) {
        io.to(teamName).emit('connected-users', {
          teamMembers: teamLists[teamName],
          dispatchers: dispatchersList
        });
      }
    });
  }

  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
    removeUserFromTeams(socket.id);
    connectedUsers.delete(socket.id);
    broadcastConnectedUsers();
  });
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});