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

      const notificationData = {
        type: 'team-progress-update',
        orderNumber,
        itemName,
        team: team.toUpperCase(),
        customerName,
        dispatcherName,
        timestamp,
        updates,
        orderData: updatedOrder,
        message: `${team.toUpperCase()} team updated progress for ${itemName} in order #${orderNumber}`
      };

      io.to('dispatchers').emit('team-progress-updated', notificationData);
      socket.broadcast.emit('team-progress-updated', notificationData);

      if (team.toLowerCase() === 'glass') {
        console.log('🔄 Glass team completion detected, checking decoration sequence...');
        checkAndTriggerDecorationSequence(updatedOrder, orderNumber, customerName, dispatcherName);
      }

      if (['printing', 'coating', 'foiling', 'frosting'].includes(team.toLowerCase())) {
        console.log(`🔄 ${team} team completion detected, checking next decoration team...`);
        checkAndTriggerNextDecorationTeam(updatedOrder, orderNumber, customerName, dispatcherName, team.toLowerCase());
      }

      console.log(`📤 Progress update sent to dispatchers for order #${orderNumber}`);

    } catch (error) {
      console.error('Error handling team progress update:', error);
    }
  });

  function checkAndTriggerDecorationSequence(order, orderNumber, customerName, dispatcherName) {
    console.log('🔍 Checking decoration sequence triggers for order:', orderNumber);
    const teamDecorationGroups = {};

    order.item_ids?.forEach(item => {
      const glassAssignments = item.team_assignments?.glass || [];
      console.log(`📋 Processing item ${item.name} with ${glassAssignments.length} glass assignments`);

      glassAssignments.forEach(glassItem => {
        // Create unique key to prevent duplicate processing
        const itemKey = `${orderNumber}_${item._id}_${glassItem._id}`;

        console.log(`🔍 Checking glass item: ${glassItem.glass_name}`);
        console.log(`📊 Glass item status: ${glassItem.status}`);
        console.log(`🎨 Glass item decoration: ${glassItem.decoration}`);

        if (glassItem.status?.toLowerCase() !== 'completed') {
          console.log(`⏳ Glass item ${glassItem.glass_name} not completed yet - skipping decoration trigger`);
          return;
        }

        if (processedItems.has(itemKey)) {
          console.log(`⚠️ Glass item ${glassItem.glass_name} already processed, skipping`);
          return;
        }

        const decorationType = glassItem.decoration;
        if (!decorationType || decorationType === 'N/A' || !DECORATION_SEQUENCES[decorationType]) {
          console.log(`❌ No valid decoration sequence for: ${decorationType}`);
          return;
        }

        const decorationSequence = DECORATION_SEQUENCES[decorationType];
        const firstDecorationTeam = decorationSequence[0];

        console.log(`✅ Glass item ${glassItem.glass_name} ready for decoration`);
        console.log(`🎯 Decoration sequence: ${decorationSequence.join(' → ')}`);
        console.log(`🏁 First team: ${firstDecorationTeam}`);

        // Check if this specific glass item already has a ready assignment
        const existingAssignments = item.team_assignments?.[firstDecorationTeam] || [];
        const hasReadyAssignment = existingAssignments.some(assignment => {
          const assignmentGlassId = assignment.glass_item_id?.toString() || assignment._id?.toString();
          const currentGlassId = glassItem._id?.toString();
          return assignmentGlassId === currentGlassId && assignment.ready_for_decoration;
        });

        if (hasReadyAssignment) {
          console.log(`⚠️ Glass item ${glassItem.glass_name} already has ready ${firstDecorationTeam} assignment`);
          return;
        }

        const groupKey = `${firstDecorationTeam}_${decorationType}`;
        if (!teamDecorationGroups[groupKey]) {
          teamDecorationGroups[groupKey] = {
            team: firstDecorationTeam,
            decorationType,
            items: []
          };
        }

        teamDecorationGroups[groupKey].items.push({
          itemId: item._id,
          itemName: item.name,
          glassItem: {
            ...glassItem,
            itemId: item._id,
            itemName: item.name
          }
        });

        processedItems.set(itemKey, true);
        console.log(`📦 Added glass item ${glassItem.glass_name} to ${groupKey} group`);
      });
    });

    console.log(`📊 Team decoration groups found:`, Object.keys(teamDecorationGroups));

    Object.values(teamDecorationGroups).forEach(group => {
      if (group.items.length > 0) {
        console.log(`🚀 Sending ${group.items.length} items to ${group.team} team for ${group.decorationType}`);
        sendItemsToDecorationTeamWithAssignments(
          order,
          orderNumber,
          customerName,
          dispatcherName,
          group.team,
          group.decorationType,
          group.items
        );
      }
    });
  }

  function checkAndTriggerNextDecorationTeam(order, orderNumber, customerName, dispatcherName, completedTeam) {
  console.log(`🔍 Checking next decoration team for ${completedTeam} completion`);

  const teamDecorationGroups = {};

  order.item_ids?.forEach(item => {
    console.log(`🔍 Processing item: ${item.name}`);
    const completedAssignments = item.team_assignments?.[completedTeam] || [];

    completedAssignments.forEach(assignment => {
      const status = assignment.status?.toLowerCase();
      const glassItemId = assignment.glass_item_id || assignment._id;
      const transitionKey = `${orderNumber}_${item._id}_${glassItemId}_${completedTeam}`;

      console.log(`📋 Checking ${completedTeam} assignment: ${assignment.glass_name || assignment[`${completedTeam}_name`]}`);
      console.log(`📊 Status: ${status}`);

      // ✅ Check 1: This team must be completed
      if (status !== 'completed') {
        console.log(`⏳ Assignment not completed yet — skipping`);
        return;
      }

      // ✅ Check 2: Already processed transition?
      if (processedItems.has(transitionKey)) {
        console.log(`⚠️ Assignment transition already processed — skipping`);
        return;
      }

      const decorationType = assignment.decoration;
      if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
        console.log(`❌ No valid decoration sequence for: ${decorationType}`);
        return;
      }

      const decorationSequence = DECORATION_SEQUENCES[decorationType];
      const currentIndex = decorationSequence.indexOf(completedTeam);

      if (currentIndex === -1 || currentIndex >= decorationSequence.length - 1) {
        console.log(`🏁 No next team in sequence for ${decorationType}`);
        return;
      }

      const nextTeam = decorationSequence[currentIndex + 1];
      console.log(`➡️ Next team: ${nextTeam}`);

      // ✅ NEW: Check if corresponding glass assignment is completed
      const glassAssignments = item.team_assignments?.glass || [];
      const matchingGlass = glassAssignments.find(glass => {
        const id = glass._id?.toString();
        return id === glassItemId?.toString();
      });

      if (!matchingGlass || matchingGlass.status?.toLowerCase() !== 'completed') {
        console.log(`🚫 Skipping — glass item ${glassItemId} is not completed yet`);
        return;
      }

      // ✅ Check if next team already has assignment
      const nextTeamAssignments = item.team_assignments?.[nextTeam] || [];
      const hasReady = nextTeamAssignments.some(nextAssign => {
        const nextId = nextAssign.glass_item_id || nextAssign._id;
        return nextId?.toString() === glassItemId?.toString() && nextAssign.ready_for_decoration;
      });

      if (hasReady) {
        console.log(`⚠️ ${nextTeam} already has ready assignment for this glass`);
        return;
      }

      const groupKey = `${nextTeam}_${decorationType}`;
      if (!teamDecorationGroups[groupKey]) {
        teamDecorationGroups[groupKey] = {
          team: nextTeam,
          decorationType,
          items: []
        };
      }

      teamDecorationGroups[groupKey].items.push({
        itemId: item._id,
        itemName: item.name,
        glassItem: {
          ...assignment,
          _id: glassItemId,
          glass_item_id: glassItemId,
          itemId: item._id,
          itemName: item.name
        }
      });

      processedItems.set(transitionKey, true);
      console.log(`📦 Added to ${nextTeam} group: ${glassItemId}`);
    });
  });

  console.log(`📊 Next team decoration groups:`, Object.keys(teamDecorationGroups));

  Object.values(teamDecorationGroups).forEach(group => {
    if (group.items.length > 0) {
      console.log(`🚀 Sending ${group.items.length} items to ${group.team} team`);
      sendItemsToDecorationTeamWithAssignments(
        order,
        orderNumber,
        customerName,
        dispatcherName,
        group.team,
        group.decorationType,
        group.items
      );
    }
  });
}


  async function sendItemsToDecorationTeamWithAssignments(order, orderNumber, customerName, dispatcherName, teamName, decorationType, itemsWithGlass) {
    console.log(`📤 Sending items to ${teamName} team for ${decorationType}`);
    console.log(`📋 Items to process:`, itemsWithGlass.length);

    if (!teamMembers[teamName] || teamMembers[teamName].size === 0) {
      console.log(`⚠️ No members online for ${teamName} team`);
      return;
    }

    try {
      const TeamModel = await getTeamModel(teamName);
      const relevantItems = [];

      // Process only items that have completed glass assignments
      for (const { itemId, itemName, glassItem } of itemsWithGlass) {
        const originalItem = order.item_ids.find(item => item._id.toString() === itemId.toString());
        if (!originalItem) {
          console.log(`❌ Original item not found for ${itemId}`);
          continue;
        }

        const glassItemId = glassItem._id || glassItem.glass_item_id;
        if (!glassItemId) {
          console.log(`❌ No glass item ID for ${itemName}`);
          continue;
        }

        console.log(`🔍 Processing item: ${itemName}, Glass: ${glassItem.glass_name}`);

        // Check if assignment already exists
        let existingAssignment = await TeamModel.findOne({
          glass_item_id: glassItemId,
          itemId: itemId,
          orderNumber
        });

        let assignmentToInclude;

        if (existingAssignment) {
          console.log(`✅ Found existing ${teamName} assignment for ${glassItem.glass_name}`);

          // Update to ready if not already
          if (!existingAssignment.ready_for_decoration) {
            await TeamModel.findByIdAndUpdate(existingAssignment._id, {
              status: 'Pending',
              ready_for_decoration: true,
              updatedAt: new Date().toISOString()
            });
            console.log(`✅ Updated ${teamName} assignment to ready:`, existingAssignment._id);
          }

          assignmentToInclude = await TeamModel.findById(existingAssignment._id).lean();
        } else {
          console.log(`❌ No existing ${teamName} assignment found for ${glassItem.glass_name}`);
          continue;
        }

        // Enrich assignment with glass data
        const enrichedAssignment = {
          ...assignmentToInclude,
          glass_name: glassItem.glass_name,
          bottle: glassItem.glass_name,
          weight: glassItem.weight,
          neck_size: glassItem.neck_size,
          decoration: glassItem.decoration,
          decoration_no: glassItem.decoration_no,
          glass_item_id: glassItemId,
          isNewAssignment: false // Mark as existing assignment
        };

        // Check if this item already exists in our relevant items
        const existingItemIndex = relevantItems.findIndex(item => item._id.toString() === itemId.toString());

        if (existingItemIndex >= 0) {
          // Add assignment to existing item
          relevantItems[existingItemIndex].team_assignments[teamName].push(enrichedAssignment);
        } else {
          // Create new item entry
          relevantItems.push({
            _id: originalItem._id,
            order_number: originalItem.order_number,
            name: originalItem.name,
            createdAt: originalItem.createdAt,
            updatedAt: originalItem.updatedAt,
            __v: originalItem.__v,
            team_assignments: {
              [teamName]: [enrichedAssignment]
            }
          });
        }

        console.log(`📦 Added ${teamName} assignment for ${itemName} - ${glassItem.glass_name}`);
      }

      if (relevantItems.length === 0) {
        console.log(`❌ No valid items to send to ${teamName}`);
        return;
      }

      // Remove duplicates within each item's assignments
      relevantItems.forEach(item => {
        if (item.team_assignments[teamName]) {
          item.team_assignments[teamName] = removeDuplicates(item.team_assignments[teamName], '_id');
        }
      });

      const filteredOrder = {
        ...order,
        item_ids: relevantItems
      };

      const notification = {
        type: 'decoration-order-ready',
        orderNumber,
        customerName,
        dispatcherName,
        timestamp: new Date().toISOString(),
        message: `Order #${orderNumber} ready for ${teamName.toUpperCase()} team (${decorationType})`,
        orderData: filteredOrder,
        decorationType,
        sequencePosition: DECORATION_SEQUENCES[decorationType].indexOf(teamName) + 1,
        totalSequenceSteps: DECORATION_SEQUENCES[decorationType].length,
        itemsCount: itemsWithGlass.length,
        isCompleteItemBatch: true
      };

      io.to(teamName).emit('decoration-order-ready', notification);
      io.to(teamName).emit('new-order', { ...notification, type: 'new-order' });

      console.log(`🚀 Successfully sent to ${teamName}:`, {
        items: relevantItems.length,
        totalAssignments: relevantItems.reduce((sum, item) => sum + (item.team_assignments[teamName]?.length || 0), 0)
      });

    } catch (error) {
      console.error(`❌ Error sending assignments to ${teamName}:`, error);
    }
  }


  function removeDuplicates(array, key) {
    const seen = new Set();
    return array.filter(item => {
      const id = item[key]?.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  async function getTeamModel(teamName) {
    if (teamName === 'printing') {
      return (await import('./models/PrintingItem.js')).default;
    } else if (teamName === 'coating') {
      return (await import('./models/CoatingItem.js')).default;
    } else if (teamName === 'foiling') {
      return (await import('./models/FoilingItem.js')).default;
    } else if (teamName === 'frosting') {
      return (await import('./models/FrostingItem.js')).default;
    }
    throw new Error(`Unknown team name: ${teamName}`);
  }

  function removeDuplicates(array, key) {
    const seen = new Set();
    return array.filter(item => {
      const id = item[key]?.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
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

  function filterOrderForTeam(order, teamName) {
    const isDecorationTeam = ['printing', 'coating', 'foiling', 'frosting'].includes(teamName);

    return {
      ...order,
      item_ids: order.item_ids?.map(item => {
        const assignment = item.team_assignments?.[teamName] || [];

        if (isDecorationTeam && assignment.length > 0) {
          const enrichedAssignments = assignment.map(deco => {
            const glassEntry = findGlassEntry(order.item_ids, deco.glass_item_id);
            return {
              ...deco,
              glass_name: glassEntry?.glass_name,
              quantity: glassEntry?.quantity,
              weight: glassEntry?.weight,
              neck_size: glassEntry?.neck_size,
              decoration_details: glassEntry?.decoration_details,
              team_tracking: glassEntry?.team_tracking
            };
          });

          return {
            ...item,
            team_assignments: {
              [teamName]: enrichedAssignments
            }
          };
        }

        return {
          ...item,
          team_assignments: {
            [teamName]: assignment
          }
        };
      }).filter(item => item.team_assignments[teamName]?.length > 0) || []
    };
  }

  function findGlassEntry(items, glassItemId) {
    for (const item of items) {
      const glassAssignments = item.team_assignments?.glass || [];
      for (const glass of glassAssignments) {
        if (glass._id?.toString() === glassItemId?.toString()) {
          return glass;
        }
      }
    }
    return null;
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