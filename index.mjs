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
    console.log('📦 New order created:', orderData.orderNumber);
    console.log('📋 Order decoration sequences:', logOrderDecorationSequences(orderData.order));

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

    // Send to normal teams (glass, caps, boxes, pumps) - they get their assignments immediately
    const normalTeams = ['glass', 'caps', 'boxes', 'pumps'];
    assignedTeams.forEach(teamName => {
      if (normalTeams.includes(teamName) && teamMembers[teamName]?.size > 0) {
        const teamOrder = getTeamOrder(order, teamName);
        if (teamOrder.item_ids.length > 0) {
          io.to(teamName).emit('new-order', {
            ...baseNotification,
            message: `New order #${orderNumber} assigned to ${teamName.toUpperCase()} team`,
            orderData: teamOrder
          });
          console.log(`📤 Order sent to ${teamName} team`);
        }
      }
    });

    // Decoration teams will receive orders when their glass items are completed
    console.log('📋 Decoration teams will receive orders based on glass completion sequence');
  });

  socket.on('team-progress-updated', (progressData) => {
    console.log('📈 Team progress updated:', progressData.orderNumber, progressData.team);
    console.log('📊 Progress data received:', {
      team: progressData.team,
      targetGlassItem: progressData.targetGlassItem,
      updatesCount: progressData.updates?.length || 0
    });

    const { orderNumber, team, updatedOrder, customerName, dispatcherName, timestamp, targetGlassItem } = progressData;

    let processedOrder = updatedOrder;
    if (typeof updatedOrder === 'string') {
      processedOrder = JSON.parse(updatedOrder);
    }

    const notificationData = {
      type: 'team-progress-update',
      orderNumber,
      team: team.toUpperCase(),
      customerName,
      dispatcherName,
      timestamp,
      targetGlassItem,
      message: `${team.toUpperCase()} team updated progress for order #${orderNumber}`
    };

    // Send to dispatchers
    io.to('dispatchers').emit('team-progress-updated', {
      ...notificationData,
      orderData: processedOrder
    });

    // Broadcast to other teams
    socket.broadcast.emit('team-progress-updated', notificationData);

    // If glass team completed, check decoration sequences
    if (team.toLowerCase() === 'glass') {
      console.log('🔍 Glass team completed - checking decoration sequences');
      checkDecorationSequences(processedOrder, orderNumber, customerName, dispatcherName);
    }

    // If decoration team completed, check next in sequence
    if (['printing', 'coating', 'foiling', 'frosting'].includes(team.toLowerCase())) {
      console.log(`🔍 ${team} team completed - checking next decoration team`);
      checkNextDecorationTeam(processedOrder, orderNumber, customerName, dispatcherName, team.toLowerCase(), targetGlassItem);
    }
  });

  socket.on('order-edited', (editData) => {
    console.log('✏️ Order edited:', editData.orderNumber);

    const { order, assignedTeams, dispatcherName, customerName, orderNumber, timestamp, editedFields, previousAssignedTeams = [] } = editData;

    const baseNotification = {
      type: 'order-edited',
      orderNumber,
      customerName,
      dispatcherName,
      timestamp,
      editedFields,
      message: `Order #${orderNumber} has been updated`
    };

    // Send to dispatchers
    io.to('dispatchers').emit('order-updated', {
      ...baseNotification,
      orderData: order
    });

    // Send to affected teams
    const allAffectedTeams = new Set([...assignedTeams, ...previousAssignedTeams]);
    allAffectedTeams.forEach(teamName => {
      if (teamMembers[teamName]?.size > 0) {
        const teamOrder = getTeamOrder(order, teamName);
        const hasCurrentAssignments = assignedTeams.includes(teamName);

        io.to(teamName).emit('order-updated', {
          ...baseNotification,
          message: hasCurrentAssignments
            ? `Order #${orderNumber} assigned to ${teamName.toUpperCase()} team has been updated`
            : `Order #${orderNumber} no longer assigned to ${teamName.toUpperCase()} team`,
          orderData: teamOrder,
          hasAssignments: hasCurrentAssignments,
          wasRemoved: !hasCurrentAssignments && previousAssignedTeams.includes(teamName)
        });
      }
    });
  });

  socket.on('order-deleted', (deleteData) => {
    console.log('🗑️ Order deleted:', deleteData.orderNumber);

    const { orderId, orderNumber, customerName, dispatcherName, timestamp, assignedTeams = [] } = deleteData;

    const baseNotification = {
      type: 'order-deleted',
      orderId,
      orderNumber,
      customerName,
      dispatcherName,
      timestamp,
      message: `Order #${orderNumber} has been deleted`
    };

    // Send to dispatchers
    io.to('dispatchers').emit('order-deleted', baseNotification);

    // Send to assigned teams
    assignedTeams.forEach(teamName => {
      if (teamMembers[teamName]?.size > 0) {
        io.to(teamName).emit('order-deleted', {
          ...baseNotification,
          message: `Order #${orderNumber} assigned to ${teamName.toUpperCase()} team has been deleted`
        });
      }
    });
  });

  function addUserToTeams(socket, userInfo) {
    const { role, team } = userInfo;

    if (role === 'admin' || role === 'dispatcher') {
      teamMembers.dispatchers.add(socket.id);
      socket.join('dispatchers');
    }

    if (team && teamMembers[team]) {
      teamMembers[team].add(socket.id);
      socket.join(team);
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

function logOrderDecorationSequences(order) {
  const sequences = [];
  order.item_ids.forEach(item => {
    const glassAssignments = item.team_assignments?.glass || [];
    glassAssignments.forEach(glass => {
      const decorationType = glass.decoration_details?.type || glass.decoration;
      if (decorationType && DECORATION_SEQUENCES[decorationType]) {
        sequences.push({
          itemName: item.name,
          glassName: glass.glass_name,
          glassId: glass._id,
          decorationType,
          sequence: DECORATION_SEQUENCES[decorationType]
        });
      }
    });
  });
  return sequences;
}

function getTeamOrder(order, teamName) {
  const filteredItems = order.item_ids.map(item => {
    const teamAssignments = item.team_assignments?.[teamName] || [];

    if (teamAssignments.length === 0) return null;

    return {
      ...item,
      team_assignments: {
        [teamName]: teamAssignments
      }
    };
  }).filter(item => item !== null);

  return {
    ...order,
    item_ids: filteredItems
  };
}

function checkDecorationSequences(order, orderNumber, customerName, dispatcherName) {
  console.log('🔍 Checking decoration sequences for completed glass items');

  order.item_ids.forEach(item => {
    const glassAssignments = item.team_assignments?.glass || [];

    glassAssignments.forEach(glass => {
      const isCompleted = glass.team_tracking?.total_completed_qty >= glass.quantity;

      if (isCompleted) {
        const decorationType = glass.decoration_details?.type || glass.decoration;

        if (decorationType && DECORATION_SEQUENCES[decorationType]) {
          const sequence = DECORATION_SEQUENCES[decorationType];
          const firstTeam = sequence[0];

          console.log(`🎯 Glass ${glass.glass_name} (ID: ${glass._id}) completed, starting sequence: ${sequence.join(' → ')}`);
          console.log(`📤 Sending to first team: ${firstTeam}`);

          sendToDecorationTeam(order, orderNumber, customerName, dispatcherName, firstTeam, glass._id);
        } else {
          console.log(`ℹ️ Glass ${glass.glass_name} completed but no decoration sequence found`);
        }
      }
    });
  });
}

function checkNextDecorationTeam(order, orderNumber, customerName, dispatcherName, completedTeam, targetGlassItem) {
  console.log(`🔍 Checking next team after ${completedTeam} completion`);
  console.log(`🎯 Target glass item: ${targetGlassItem}`);

  if (!targetGlassItem) {
    console.warn('⚠️ No targetGlassItem provided - cannot determine next decoration team');
    return;
  }

  // Find the glass item to determine its decoration sequence
  const glassItem = findGlassItem(order, targetGlassItem);

  if (!glassItem) {
    console.warn(`⚠️ Glass item ${targetGlassItem} not found in order`);
    return;
  }

  const decorationType = glassItem.decoration_details?.type || glassItem.decoration;

  if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
    console.log(`ℹ️ No decoration sequence found for glass ${glassItem.glass_name}`);
    return;
  }

  const sequence = DECORATION_SEQUENCES[decorationType];
  const currentIndex = sequence.indexOf(completedTeam);
  const nextTeam = sequence[currentIndex + 1];

  console.log(`📋 Decoration sequence for glass ${glassItem.glass_name}: ${sequence.join(' → ')}`);
  console.log(`📍 Current team: ${completedTeam} (index: ${currentIndex})`);
  console.log(`🎯 Next team: ${nextTeam || 'None - sequence complete'}`);

  if (nextTeam) {
    // Check if the current team's work is actually completed for this specific glass item
    const isCurrentTeamCompleted = checkTeamCompletionForGlassItem(order, completedTeam, targetGlassItem);

    if (isCurrentTeamCompleted) {
      console.log(`✅ ${completedTeam} completed for glass ${glassItem.glass_name}, sending to ${nextTeam}`);
      sendToDecorationTeam(order, orderNumber, customerName, dispatcherName, nextTeam, targetGlassItem);
    } else {
      console.log(`⏳ ${completedTeam} not yet completed for glass ${glassItem.glass_name}`);
    }
  } else {
    console.log(`🎉 All decoration steps completed for glass ${glassItem.glass_name}`);
  }
}

function checkTeamCompletionForGlassItem(order, teamName, glassItemId) {
  for (const item of order.item_ids) {
    const teamAssignments = item.team_assignments?.[teamName] || [];

    for (const assignment of teamAssignments) {
      const assignmentGlassId = assignment.glass_item_id?._id || assignment.glass_item_id;

      if (assignmentGlassId?.toString() === glassItemId?.toString()) {
        const isCompleted = assignment.team_tracking?.total_completed_qty >= assignment.quantity;
        console.log(`📊 ${teamName} completion check for glass ${glassItemId}: ${isCompleted ? 'COMPLETED' : 'PENDING'} (${assignment.team_tracking?.total_completed_qty || 0}/${assignment.quantity})`);
        return isCompleted;
      }
    }
  }

  console.log(`❌ No ${teamName} assignment found for glass ${glassItemId}`);
  return false;
}

function sendToDecorationTeam(order, orderNumber, customerName, dispatcherName, teamName, glassItemId) {
  console.log(`📤 Preparing to send to ${teamName} team for glass ${glassItemId}`);

  if (!teamMembers[teamName]?.size) {
    console.log(`⚠️ No ${teamName} team members connected`);
    return;
  }

  const decorationOrder = getDecorationOrder(order, teamName, glassItemId);

  if (decorationOrder.item_ids.length === 0) {
    console.log(`❌ No items found for ${teamName} team for glass ${glassItemId}`);
    return;
  }

  const notification = {
    type: 'decoration-sequence',
    orderNumber,
    customerName,
    dispatcherName,
    timestamp: new Date().toISOString(),
    message: `Order #${orderNumber} ready for ${teamName.toUpperCase()} team`,
    orderData: decorationOrder,
    targetGlassItem: glassItemId
  };

  io.to(teamName).emit('new-order', notification);
  console.log(`✅ Order sent to ${teamName} team for glass ${glassItemId}`);
  console.log(`📋 Items sent: ${decorationOrder.item_ids.length}`);
}

function getDecorationOrder(order, teamName, glassItemId) {
  console.log(`🔍 Building decoration order for ${teamName} team, glass ${glassItemId}`);

  const filteredItems = order.item_ids.map(item => {
    const teamAssignments = item.team_assignments?.[teamName] || [];

    // Filter assignments for the specific glass item
    const relevantAssignments = teamAssignments.filter(assignment => {
      const assignmentGlassId = assignment.glass_item_id?._id || assignment.glass_item_id;
      const isMatch = assignmentGlassId?.toString() === glassItemId?.toString();

      if (isMatch) {
        console.log(`✅ Found matching assignment for glass ${glassItemId} in ${teamName} team`);
      }

      return isMatch;
    });

    if (relevantAssignments.length === 0) {
      console.log(`❌ No ${teamName} assignments found for glass ${glassItemId} in item ${item.name}`);
      return null;
    }

    console.log(`📦 Including item ${item.name} with ${relevantAssignments.length} ${teamName} assignments`);

    return {
      ...item,
      team_assignments: {
        [teamName]: relevantAssignments
      }
    };
  }).filter(item => item !== null);

  console.log(`📊 Decoration order summary: ${filteredItems.length} items for ${teamName} team`);

  return {
    ...order,
    item_ids: filteredItems
  };
}

function findGlassItem(order, glassItemId) {
  console.log(`🔍 Searching for glass item: ${glassItemId}`);

  for (const item of order.item_ids) {
    const glassAssignments = item.team_assignments?.glass || [];
    const glass = glassAssignments.find(g => g._id?.toString() === glassItemId?.toString());

    if (glass) {
      console.log(`✅ Found glass item: ${glass.glass_name} (ID: ${glass._id})`);
      return glass;
    }
  }

  console.log(`❌ Glass item ${glassItemId} not found in order`);
  return null;
}

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});