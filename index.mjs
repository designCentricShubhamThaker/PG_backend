import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import './config/db.js';
import routes from './routes/index.js';
import { ObjectId } from 'mongodb';

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

// Track processed items to prevent duplicates
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

      // Send to all dispatchers
      io.to('dispatchers').emit('team-progress-updated', notificationData);
      socket.broadcast.emit('team-progress-updated', notificationData);

      // Check if this is a glass team completion and trigger sequential decoration flow
      if (team.toLowerCase() === 'glass') {
        console.log('🔄 Glass team completion detected, checking decoration sequence...');
        checkAndTriggerDecorationSequence(updatedOrder, orderNumber, customerName, dispatcherName);
      }

      // Check if this is a decoration team completion and trigger next in sequence
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

      // ✅ FIXED: Check if glass is completed - this is the critical fix
      if (glassItem.status?.toLowerCase() !== 'completed') {
        console.log(`⏳ Glass item ${glassItem.glass_name} not completed yet - skipping decoration trigger`);
        return;
      }

      // Check if already processed
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

      // ✅ FIXED: Better check for existing decoration assignments
      const existingAssignments = item.team_assignments?.[firstDecorationTeam] || [];
      
      // Check if there's already a ready assignment for this specific glass item
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

      // Mark as processed
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

      // Get completed assignments from the current team
      const completedTeamAssignments = item.team_assignments?.[completedTeam] || [];

      completedTeamAssignments.forEach(assignment => {
        console.log(`📋 Checking ${completedTeam} assignment: ${assignment.glass_name || assignment[`${completedTeam}_name`]}`);

        // Only process completed assignments
        if (assignment.status?.toLowerCase() !== 'completed') {
          console.log(`⏳ Assignment not completed yet`);
          return;
        }

        // Create unique key for this assignment transition
        const transitionKey = `${orderNumber}_${item._id}_${assignment._id}_${completedTeam}`;

        if (processedItems.has(transitionKey)) {
          console.log(`⚠️ Assignment transition already processed, skipping`);
          return;
        }

        const decorationType = assignment.decoration;
        if (!decorationType || !DECORATION_SEQUENCES[decorationType]) {
          console.log(`❌ No valid decoration sequence for: ${decorationType}`);
          return;
        }

        const decorationSequence = DECORATION_SEQUENCES[decorationType];
        const currentTeamIndex = decorationSequence.indexOf(completedTeam);

        console.log(`📋 Decoration sequence: ${decorationSequence.join(' → ')}`);
        console.log(`📍 Current team index: ${currentTeamIndex}`);

        // Check if there's a next team in the sequence
        if (currentTeamIndex === -1 || currentTeamIndex >= decorationSequence.length - 1) {
          console.log(`🏁 No next team in sequence for ${decorationType}`);
          return;
        }

        const nextTeam = decorationSequence[currentTeamIndex + 1];
        console.log(`➡️ Next team: ${nextTeam}`);

        // FIX: Get the actual glass item ID from the assignment
        const actualGlassItemId = assignment.glass_item_id || assignment._id;
        console.log(`🔍 Looking for next team assignment with glass_item_id: ${actualGlassItemId}`);

        // Check if next team already has assignments for this glass item
        const nextTeamAssignments = item.team_assignments?.[nextTeam] || [];
        const hasExistingAssignment = nextTeamAssignments.some(nextAssignment =>
          nextAssignment.glass_item_id?.toString() === actualGlassItemId?.toString() &&
          nextAssignment.ready_for_decoration
        );

        if (hasExistingAssignment) {
          console.log(`⚠️ Next team ${nextTeam} already has ready assignment for this item`);
          return;
        }

        // Group by team and decoration type
        const groupKey = `${nextTeam}_${decorationType}`;
        if (!teamDecorationGroups[groupKey]) {
          teamDecorationGroups[groupKey] = {
            team: nextTeam,
            decorationType,
            items: []
          };
        }

        // Add this assignment to the group - pass the actual glass item ID
        teamDecorationGroups[groupKey].items.push({
          itemId: item._id,
          itemName: item.name,
          glassItem: {
            ...assignment,
            _id: actualGlassItemId,  // Use the actual glass item ID
            glass_item_id: actualGlassItemId,  // Ensure this is set correctly
            itemId: item._id,
            itemName: item.name
          }
        });

        // Mark transition as processed
        processedItems.set(transitionKey, true);
        console.log(`📦 Added assignment to ${groupKey} group with glass_item_id: ${actualGlassItemId}`);
      });
    });

    console.log(`📊 Next team decoration groups:`, Object.keys(teamDecorationGroups));

    // Send items to their respective next decoration teams
    Object.values(teamDecorationGroups).forEach(group => {
      if (group.items.length > 0) {
        console.log(`🚀 Sending ${group.items.length} items from ${completedTeam} to ${group.team} team`);
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

  if (!teamMembers[teamName] || teamMembers[teamName].size === 0) {
    console.log(`⚠️ No members online for ${teamName} team`);
    return;
  }

  try {
    const modifiedOrder = {
      ...order,
      item_ids: []
    };

    for (const item of order.item_ids) {
      const relevantItems = itemsWithGlass.filter(d => d.itemId.toString() === item._id.toString());

      if (relevantItems.length === 0) {
        continue; // Skip items that don't have assignments for this team
      }

      const validAssignments = [];

      for (const { glassItem } of relevantItems) {
        try {
          // ✅ FIXED: Better glass item validation
          const glassItemId = glassItem._id || glassItem.glass_item_id;
          
          if (!glassItemId) {
            console.log(`❌ No valid glass item ID found for ${glassItem.glass_name}`);
            continue;
          }
if (glassItem.status?.toLowerCase() !== 'completed') {
  console.log(`❌ Glass item ${glassItem.glass_name} is not completed (from payload), skipping decoration assignment`);
  continue;
}


          // Find existing decoration assignment
          let existingAssignment = null;

          if (teamName === 'printing') {
            const PrintingItem = (await import('./models/PrintingItem.js')).default;
            existingAssignment = await PrintingItem.findOne({
              glass_item_id: glassItemId,
              itemId: item._id,
              orderNumber: orderNumber
            });
          } else if (teamName === 'coating') {
            const CoatingItem = (await import('./models/CoatingItem.js')).default;
            existingAssignment = await CoatingItem.findOne({
              glass_item_id: glassItemId,
              itemId: item._id,
              orderNumber: orderNumber
            });
          } else if (teamName === 'foiling') {
            const FoilingItem = (await import('./models/FoilingItem.js')).default;
            existingAssignment = await FoilingItem.findOne({
              glass_item_id: glassItemId,
              itemId: item._id,
              orderNumber: orderNumber
            });
          } else if (teamName === 'frosting') {
            const FrostingItem = (await import('./models/FrostingItem.js')).default;
            existingAssignment = await FrostingItem.findOne({
              glass_item_id: glassItemId,
              itemId: item._id,
              orderNumber: orderNumber
            });
          }

          if (existingAssignment) {
            // Only update if not already ready for decoration
            if (!existingAssignment.ready_for_decoration) {
              const updateData = {
                status: 'Pending',
                ready_for_decoration: true,
                updatedAt: new Date().toISOString()
              };

              if (teamName === 'printing') {
                const PrintingItem = (await import('./models/PrintingItem.js')).default;
                await PrintingItem.findByIdAndUpdate(existingAssignment._id, updateData);
              } else if (teamName === 'coating') {
                const CoatingItem = (await import('./models/CoatingItem.js')).default;
                await CoatingItem.findByIdAndUpdate(existingAssignment._id, updateData);
              } else if (teamName === 'foiling') {
                const FoilingItem = (await import('./models/FoilingItem.js')).default;
                await FoilingItem.findByIdAndUpdate(existingAssignment._id, updateData);
              } else if (teamName === 'frosting') {
                const FrostingItem = (await import('./models/FrostingItem.js')).default;
                await FrostingItem.findByIdAndUpdate(existingAssignment._id, updateData);
              }

              console.log(`✅ Updated existing ${teamName} assignment for completed glass item:`, existingAssignment._id);
            } else {
              console.log(`✅ Found existing ${teamName} assignment (already ready):`, existingAssignment._id);
            }

            const updatedAssignment = await getUpdatedAssignment(teamName, existingAssignment._id);
            if (updatedAssignment) {
              validAssignments.push(updatedAssignment);
            }
          } else {
            console.log(`⚠️ No existing ${teamName} assignment found for glass item ${glassItemId}`);
          }
        } catch (error) {
          console.error(`❌ Error processing ${teamName} assignment:`, error);
        }
      }

      if (validAssignments.length === 0) {
        console.log(`❌ No valid assignments found for item ${item._id} in ${teamName} team`);
        continue;
      }

      // Remove duplicates based on _id
      const uniqueAssignments = validAssignments.filter((assignment, index, self) =>
        index === self.findIndex(a => a._id.toString() === assignment._id.toString())
      );

      console.log(`📋 Found ${uniqueAssignments.length} valid assignments for item ${item.name}`);

      // Add to modified order with only this team's assignments
      modifiedOrder.item_ids.push({
        _id: item._id,
        order_number: item.order_number,
        name: item.name,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        __v: item.__v,
        // Only include assignments for THIS team
        team_assignments: {
          [teamName]: uniqueAssignments
        }
      });
    }

    console.log(`📦 Final filtered order for ${teamName}:`, {
      itemsCount: modifiedOrder.item_ids.length,
      totalAssignments: modifiedOrder.item_ids.reduce((sum, item) => sum + (item.team_assignments?.[teamName]?.length || 0), 0)
    });

    if (modifiedOrder.item_ids.length > 0) {
      const notification = {
        type: 'decoration-order-ready',
        orderNumber,
        customerName,
        dispatcherName,
        timestamp: new Date().toISOString(),
        message: `Order #${orderNumber} ready for ${teamName.toUpperCase()} team (${decorationType})`,
        orderData: modifiedOrder,
        decorationType,
        sequencePosition: DECORATION_SEQUENCES[decorationType].indexOf(teamName) + 1,
        totalSequenceSteps: DECORATION_SEQUENCES[decorationType].length,
        itemsCount: itemsWithGlass.length,
        isCompleteItemBatch: true
      };

      io.to(teamName).emit('decoration-order-ready', notification);
      io.to(teamName).emit('new-order', {
        ...notification,
        type: 'new-order'
      });

      console.log(`🚀 Sent to ${teamName} → ${itemsWithGlass.length} items with valid completed glass assignments`);
    } else {
      console.log(`❌ No valid assignments to send to ${teamName} - all glass items must be completed first`);
    }

  } catch (error) {
    console.error(`❌ Error finding/updating ${teamName} assignments:`, error);
  }
}

  async function getUpdatedAssignment(teamName, assignmentId) {
    try {
      if (teamName === 'printing') {
        const PrintingItem = (await import('./models/PrintingItem.js')).default;
        return await PrintingItem.findById(assignmentId)
          .populate('glass_item_id itemId')
          .lean();
      } else if (teamName === 'coating') {
        const CoatingItem = (await import('./models/CoatingItem.js')).default;
        return await CoatingItem.findById(assignmentId)
          .populate('glass_item_id itemId')
          .lean();
      } else if (teamName === 'foiling') {
        const FoilingItem = (await import('./models/FoilingItem.js')).default;
        return await FoilingItem.findById(assignmentId)
          .populate('glass_item_id itemId')
          .lean();
      } else if (teamName === 'frosting') {
        const FrostingItem = (await import('./models/FrostingItem.js')).default;
        return await FrostingItem.findById(assignmentId)
          .populate('glass_item_id itemId')
          .lean();
      }
    } catch (error) {
      return null;
    }
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
      const match = glassAssignments.find(entry => entry._id?.toString() === glassItemId?.toString());
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