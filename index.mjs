


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

// Define decoration sequences - ONLY start from glass completion
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
      const decorationTeams = ['printing', 'coating', 'foiling', 'frosting'];

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

      // For decoration teams, we DON'T send the order now - they'll get it when their turn comes
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

      // Send to all dispatchers
      io.to('dispatchers').emit('team-progress-updated', notificationData);
      socket.broadcast.emit('team-progress-updated', notificationData);

      // Check if this is a glass team completion and trigger sequential decoration flow
      if (team.toLowerCase() === 'glass') {
        checkAndTriggerDecorationSequence(updatedOrder, orderNumber, customerName, dispatcherName);
      }

      // Check if this is a decoration team completion and trigger next in sequence
      if (['printing', 'coating', 'foiling', 'frosting'].includes(team.toLowerCase())) {
        checkAndTriggerNextDecorationTeam(updatedOrder, orderNumber, customerName, dispatcherName, team.toLowerCase());
      }

      console.log(`📤 Progress update sent to dispatchers for order #${orderNumber}`);

    } catch (error) {
      console.error('Error handling team progress update:', error);
    }
  });

  function checkAndTriggerDecorationSequence(order, orderNumber, customerName, dispatcherName) {
    console.log('🔍 Checking decoration sequence triggers for order:', orderNumber);

    // Group items by their completion status and decoration requirements
    const itemDecorationStatus = {};

    // Process each item in the order
    order.item_ids?.forEach(item => {
      const glassAssignments = item.team_assignments?.glass || [];

      if (glassAssignments.length === 0) return;

      // Check if ALL glass assignments for this item are completed
      const allGlassCompleted = glassAssignments.every(glassItem =>
        glassItem.status?.toLowerCase() === 'completed'
      );

      if (!allGlassCompleted) {
        console.log(`⏳ Item ${item.name} still has pending glass assignments`);
        return; // Skip this item if not all glass is completed
      }

      // Group glass items by decoration type for this item
      const decorationGroups = {};
      glassAssignments.forEach(glassItem => {
        const decorationType = glassItem.decoration;
        if (decorationType && decorationType !== 'N/A' && DECORATION_SEQUENCES[decorationType]) {
          if (!decorationGroups[decorationType]) {
            decorationGroups[decorationType] = [];
          }
          decorationGroups[decorationType].push({
            ...glassItem,
            itemId: item._id,
            itemName: item.name
          });
        }
      });

      // For each decoration type in this item, check if we should trigger decoration teams
      Object.keys(decorationGroups).forEach(decorationType => {
        const glassItems = decorationGroups[decorationType];
        const firstDecorationTeam = DECORATION_SEQUENCES[decorationType][0];

        // Check if this item already has assignments for the first decoration team
        const existingAssignments = item.team_assignments?.[firstDecorationTeam] || [];
        const hasExistingAssignments = existingAssignments.length > 0;

        if (!hasExistingAssignments) {
          console.log(`🚀 All glass completed for item ${item.name} - sending to ${firstDecorationTeam}`);

          // Store the information for batch processing
          if (!itemDecorationStatus[decorationType]) {
            itemDecorationStatus[decorationType] = {
              firstTeam: firstDecorationTeam,
              items: []
            };
          }

          itemDecorationStatus[decorationType].items.push({
            itemId: item._id,
            itemName: item.name,
            glassItems: glassItems
          });
        } else {
          console.log(`⏭️ Item ${item.name} already has ${firstDecorationTeam} assignments`);
        }
      });
    });

    // Now send complete items to decoration teams
    Object.keys(itemDecorationStatus).forEach(decorationType => {
      const decorationInfo = itemDecorationStatus[decorationType];

      if (decorationInfo.items.length > 0) {
        console.log(`📦 Sending ${decorationInfo.items.length} complete items to ${decorationInfo.firstTeam}`);
        sendCompleteItemsToDecorationTeam(
          order,
          orderNumber,
          customerName,
          dispatcherName,
          decorationInfo.firstTeam,
          decorationType,
          decorationInfo.items
        );
      }
    });
  }

  function checkAndTriggerNextDecorationTeam(order, orderNumber, customerName, dispatcherName, completedTeam) {
    console.log(`🔍 Checking next decoration team trigger for ${completedTeam} completion`);

    // Group completed items by decoration type
    const completedItemsByDecoration = {};

    order.item_ids?.forEach(item => {
      const glassAssignments = item.team_assignments?.glass || [];
      const completedTeamAssignments = item.team_assignments?.[completedTeam] || [];

      // Check if ALL assignments for this item in the completed team are done
      const allItemAssignmentsCompleted = completedTeamAssignments.length > 0 &&
        completedTeamAssignments.every(assignment =>
          assignment.status?.toLowerCase() === 'completed'
        );

      if (!allItemAssignmentsCompleted) {
        console.log(`⏳ Item ${item.name} still has pending ${completedTeam} assignments`);
        return; // Skip this item if not all assignments are completed
      }

      // Group glass items by decoration type for this completed item
      const decorationGroups = {};
      glassAssignments.forEach(glassItem => {
        const decorationType = glassItem.decoration;
        if (decorationType && DECORATION_SEQUENCES[decorationType]) {
          const decorationSequence = DECORATION_SEQUENCES[decorationType];
          const currentTeamIndex = decorationSequence.indexOf(completedTeam);

          if (currentTeamIndex !== -1 && currentTeamIndex < decorationSequence.length - 1) {
            const nextTeam = decorationSequence[currentTeamIndex + 1];

            // Check if this glass item's assignment exists and is completed in the current team
            const isGlassItemCompleted = completedTeamAssignments.some(assignment => {
              const isForThisGlass = assignment.glass_item_id === glassItem._id;
              const isCompleted = assignment.status?.toLowerCase() === 'completed';
              return isForThisGlass && isCompleted;
            });

            if (isGlassItemCompleted) {
              if (!decorationGroups[decorationType]) {
                decorationGroups[decorationType] = {
                  nextTeam: nextTeam,
                  glassItems: []
                };
              }
              decorationGroups[decorationType].glassItems.push({
                ...glassItem,
                itemId: item._id,
                itemName: item.name
              });
            }
          }
        }
      });

      // Add completed items to the batch
      Object.keys(decorationGroups).forEach(decorationType => {
        const decorationInfo = decorationGroups[decorationType];

        if (!completedItemsByDecoration[decorationType]) {
          completedItemsByDecoration[decorationType] = {
            nextTeam: decorationInfo.nextTeam,
            items: []
          };
        }

        completedItemsByDecoration[decorationType].items.push({
          itemId: item._id,
          itemName: item.name,
          glassItems: decorationInfo.glassItems
        });
      });
    });

    // Send completed items to their respective next teams
    Object.keys(completedItemsByDecoration).forEach(decorationType => {
      const decorationInfo = completedItemsByDecoration[decorationType];

      if (decorationInfo.items.length > 0) {
        console.log(`🚀 Sending ${decorationInfo.items.length} completed items from ${completedTeam} to ${decorationInfo.nextTeam}`);
        sendCompleteItemsToDecorationTeam(
          order,
          orderNumber,
          customerName,
          dispatcherName,
          decorationInfo.nextTeam,
          decorationType,
          decorationInfo.items
        );
      }
    });
  }

  function sendCompleteItemsToDecorationTeam(order, orderNumber, customerName, dispatcherName, teamName, decorationType, completeItems) {
    console.log(`📤 Sending ${completeItems.length} complete items to ${teamName} team for ${decorationType}`);

    if (!teamMembers[teamName] || teamMembers[teamName].size === 0) {
      console.log(`⚠️ No members online for ${teamName} team`);
      return;
    }

    const filteredOrder = filterCompleteItemsForDecorationTeam(order, teamName, decorationType, completeItems);

    if (filteredOrder.item_ids?.length > 0) {
      const totalAssignments = filteredOrder.item_ids.reduce((sum, item) =>
        sum + (item.team_assignments?.[teamName]?.length || 0), 0
      );

      console.log(`📊 Complete items for ${teamName}: ${filteredOrder.item_ids.length} items, ${totalAssignments} assignments`);

      const notification = {
        type: 'decoration-sequence-order',
        orderNumber,
        customerName,
        dispatcherName,
        timestamp: new Date().toISOString(),
        message: `Order #${orderNumber} ready for ${teamName.toUpperCase()} team (${decorationType})`,
        orderData: filteredOrder,
        decorationType,
        sequencePosition: DECORATION_SEQUENCES[decorationType].indexOf(teamName) + 1,
        totalSequenceSteps: DECORATION_SEQUENCES[decorationType].length,
        itemsCount: completeItems.length,
        isCompleteItemBatch: true // Flag to indicate this is a complete item batch
      };

      io.to(teamName).emit('decoration-order-ready', notification);
      console.log(`✅ Successfully sent complete items to ${teamName} team`);
    } else {
      console.log(`⚠️ No valid complete items for ${teamName} team`);
    }
  }

  function filterCompleteItemsForDecorationTeam(order, teamName, decorationType, completeItems) {
    console.log(`🔍 Filtering complete items for ${teamName} team`);

    const filteredOrder = {
      ...order,
      item_ids: []
    };

    // Process each complete item
    completeItems.forEach(completeItem => {
      const parentItem = order.item_ids.find(item => item._id === completeItem.itemId);
      if (!parentItem) return;

      const decorationAssignments = [];

      // Create decoration assignments for all glass items in this complete item
      completeItem.glassItems.forEach(glassItem => {
        if (glassItem.decoration === decorationType &&
          DECORATION_SEQUENCES[decorationType] &&
          DECORATION_SEQUENCES[decorationType].includes(teamName)) {

          // Check if assignment already exists
          const existingAssignment = parentItem.team_assignments?.[teamName]?.find(assignment =>
            assignment.glass_item_id === glassItem._id
          );

          if (!existingAssignment) {
            console.log(`✅ Creating new ${teamName} assignment for ${glassItem.glass_name}`);

            const decorationAssignment = {
              _id: glassItem._id,
              glass_item_id: glassItem._id,
              glass_name: glassItem.glass_name,
              quantity: glassItem.quantity,
              weight: glassItem.weight,
              neck_size: glassItem.neck_size,
              decoration: glassItem.decoration,
              decoration_no: glassItem.decoration_no,
              decoration_details: glassItem.decoration_details,
              team_tracking: {
                total_completed_qty: 0,
                completed_date: null,
                last_updated: new Date().toISOString()
              },
              status: 'Pending',
              ready_for_decoration: true,
              source_glass_item: glassItem,
              [`${teamName}_name`]: glassItem.glass_name,
              bottle: glassItem.glass_name
            };

            decorationAssignments.push(decorationAssignment);
          }
        }
      });

      if (decorationAssignments.length > 0) {
        filteredOrder.item_ids.push({
          ...parentItem,
          team_assignments: {
            [teamName]: decorationAssignments
          }
        });
      }
    });

    console.log(`📦 Filtered complete items result: ${filteredOrder.item_ids.length} items with ${teamName} assignments`);
    return filteredOrder;
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
      const match = glassAssignments.find(entry => entry._id === glassItemId);
      if (match) return match;
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









