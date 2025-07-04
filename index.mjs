// import express from 'express';
// import dotenv from 'dotenv';
// import cors from 'cors';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import './config/db.js';
// import routes from './routes/index.js';

// dotenv.config();

// const app = express();
// app.use(express.json());

// const httpServer = createServer(app);

// // app.use(cors({
// //   // origin: process.env.PROD_CLIENT_URL,
// //   origin: process.env.PROD_CLIENT_URL,
// //   credentials: true
// // }));

// app.use(cors({
//   origin: '*',         // WARNING: This will NOT work with credentials
//   credentials: true    // So this combination is invalid
// }));

// const io = new Server(httpServer, {
//   cors: {
//     // origin: "https://pragati-glass-p1.vercel.app",
//     origin: "http://localhost:5173",
//     methods: ["GET", "POST"],
//     credentials: true
//   }
// });

// const connectedUsers = new Map();
// const teamMembers = {
//   dispatchers: new Set(),
//   glass: new Set(),
//   caps: new Set(),
//   boxes: new Set(),
//   pumps: new Set(),
//   printing: new Set(),
//   coating: new Set(),
//   foiling: new Set(),
//   frosting: new Set()
// };

// app.use('/api', routes);

// app.get('/', (req, res) => {
//   res.send('Pragati Glass Order Management API is Running!');
// });

// io.on('connection', (socket) => {
//   console.log(`🔌 New connection: ${socket.id}`);

//   const { userId, role, team } = socket.handshake.query;
//   if (userId && role) {
//     const userInfo = {
//       socketId: socket.id,
//       userId,
//       role,
//       team: team?.toLowerCase().trim(),
//       connected: true
//     };

//     connectedUsers.set(socket.id, userInfo);
//     addUserToTeams(socket, userInfo);
//     broadcastConnectedUsers();
//   }

//   socket.on('register', (userData) => {
//     const { userId, role, team } = userData;
//     const userInfo = {
//       socketId: socket.id,
//       userId: userId || socket.id,
//       role,
//       team: team?.toLowerCase().trim(),
//       connected: true
//     };

//     removeUserFromTeams(socket.id);
//     connectedUsers.set(socket.id, userInfo);
//     addUserToTeams(socket, userInfo);

//     socket.emit('registered', { success: true, user: userInfo });
//     broadcastConnectedUsers();
//   });

//   socket.on('new-order-created', (orderData) => {
//     console.log('📦 New order notification received:', orderData.orderNumber);

//     try {
//       const { order, assignedTeams, dispatcherName, customerName, orderNumber, timestamp } = orderData;

//       // DEBUG: Log the assigned teams and team members
//       console.log('🔍 Assigned Teams:', assignedTeams);
//       console.log('🔍 Available Team Members:', Object.keys(teamMembers));
//       console.log('🔍 Team Members Sizes:', {
//         dispatchers: teamMembers.dispatchers.size,
//         glass: teamMembers.glass.size,
//         caps: teamMembers.caps.size,
//         boxes: teamMembers.boxes.size,
//         pumps: teamMembers.pumps.size,
//         printing: teamMembers.printing.size,
//         foiling: teamMembers.foiling.size,
//         coating: teamMembers.coating.size,
//         frosting: teamMembers.frosting.size,
//       });

//       const baseNotification = {
//         type: 'new-order',
//         orderNumber,
//         customerName,
//         dispatcherName,
//         timestamp,
//         message: `New order #${orderNumber} created for ${customerName}`
//       };
//       io.to('dispatchers').emit('new-order', {
//         ...baseNotification,
//         orderData: order
//       });

//       assignedTeams.forEach(teamName => {
//         console.log(`🔍 Checking team: ${teamName}`);
//         console.log(`🔍 Team exists in teamMembers: ${!!teamMembers[teamName]}`);
//         console.log(`🔍 Team has members: ${teamMembers[teamName]?.size || 0}`);

//         if (teamMembers[teamName] && teamMembers[teamName].size > 0) {
//           const filteredOrder = filterOrderForTeam(order, teamName);
//           console.log(`🔍 Filtered order for ${teamName}:`, JSON.stringify(filteredOrder, null, 2));

//           io.to(teamName).emit('new-order', {
//             ...baseNotification,
//             message: `New order #${orderNumber} assigned to ${teamName.toUpperCase()} team`,
//             orderData: filteredOrder
//           });

//           console.log(`📤 Filtered order sent to ${teamName} team`);
//         } else {
//           console.log(`❌ No members found for  team: ${teamName}`);
//         }
//       });

//     } catch (error) {
//       console.error('Error handling order notification:', error);
//     }
//   });


//   socket.on('team-progress-updated', (progressData) => {
//     console.log('📈 Team progress update received:', {
//       order: progressData.orderNumber,
//       team: progressData.team,
//       item: progressData.itemName
//     });

//     try {
//       const {
//         orderNumber,
//         itemName,
//         team,
//         updates,
//         updatedOrder,
//         customerName,
//         dispatcherName,
//         timestamp
//       } = progressData;

//       const notificationData = {
//         type: 'team-progress-update',
//         orderNumber,
//         itemName,
//         team: team.toUpperCase(),
//         customerName,
//         dispatcherName,
//         timestamp,
//         updates,
//         orderData: updatedOrder, // This is the key - make sure updatedOrder is included
//         message: `${team.toUpperCase()} team updated progress for ${itemName} in order #${orderNumber}`
//       };

//       // Send to all dispatchers (admins)
//       io.to('dispatchers').emit('team-progress-updated', notificationData);

//       // Also emit to all connected clients in case dispatcher isn't in dispatchers room
//       socket.broadcast.emit('team-progress-updated', notificationData);

//       console.log(`📤 Progress update sent to dispatchers for order #${orderNumber}`);
//       console.log(`📊 Dispatchers room size:`, io.sockets.adapter.rooms.get('dispatchers')?.size || 0);

//     } catch (error) {
//       console.error('Error handling team progress update:', error);
//     }
//   });;


//   socket.on('order-edited', (editData) => {
//     console.log('✏️ Order edit notification received:', editData.orderNumber);

//     try {
//       const {
//         order,
//         assignedTeams,
//         dispatcherName,
//         customerName,
//         orderNumber,
//         timestamp,
//         editedFields,
//         previousAssignedTeams = []
//       } = editData;

//       const baseNotification = {
//         type: 'order-edited',
//         orderNumber,
//         customerName,
//         dispatcherName,
//         timestamp,
//         editedFields,
//         message: `Order #${orderNumber} has been updated`
//       };


//       io.to('dispatchers').emit('order-updated', {
//         ...baseNotification,
//         orderData: order
//       });

//       const allAffectedTeams = new Set([...assignedTeams, ...previousAssignedTeams]);


//       allAffectedTeams.forEach(teamName => {
//         if (teamMembers[teamName] && teamMembers[teamName].size > 0) {
//           const filteredOrder = filterOrderForTeam(order, teamName);

//           const hasCurrentAssignments = assignedTeams.includes(teamName);

//           io.to(teamName).emit('order-updated', {
//             ...baseNotification,
//             message: hasCurrentAssignments
//               ? `Order #${orderNumber} assigned to ${teamName.toUpperCase()} team has been updated`
//               : `Order #${orderNumber} no longer assigned to ${teamName.toUpperCase()} team`,
//             orderData: filteredOrder,
//             hasAssignments: hasCurrentAssignments,
//             wasRemoved: !hasCurrentAssignments && previousAssignedTeams.includes(teamName)
//           });

//           console.log(`📤 Updated order sent to ${teamName} team (hasAssignments: ${hasCurrentAssignments})`);
//         }
//       });

//     } catch (error) {
//       console.error('Error handling order edit notification:', error);
//     }
//   });

//   socket.on('order-deleted', (deleteData) => {
//     console.log('🗑️ Order delete notification received:', deleteData.orderNumber);

//     try {
//       const {
//         orderId,
//         orderNumber,
//         customerName,
//         dispatcherName,
//         timestamp,
//         assignedTeams = []
//       } = deleteData;

//       const baseNotification = {
//         type: 'order-deleted',
//         orderId,
//         orderNumber,
//         customerName,
//         dispatcherName,
//         timestamp,
//         message: `Order #${orderNumber} has been deleted`
//       };

//       // Send to all dispatchers
//       io.to('dispatchers').emit('order-deleted', {
//         ...baseNotification
//       });

//       assignedTeams.forEach(teamName => {
//         if (teamMembers[teamName] && teamMembers[teamName].size > 0) {
//           io.to(teamName).emit('order-deleted', {
//             ...baseNotification,
//             message: `Order #${orderNumber} assigned to ${teamName.toUpperCase()} team has been deleted`
//           });

//           console.log(`📤 Delete notification sent to ${teamName} team`);
//         }
//       });

//       console.log(`📤 Order delete notification sent to all teams and dispatchers`);

//     } catch (error) {
//       console.error('Error handling order delete notification:', error);
//     }
//   });

//   function addUserToTeams(socket, userInfo) {
//     const { role, team } = userInfo;

//     // Fix: Make sure admin role joins dispatchers room
//     if (role === 'admin' || role === 'dispatcher') {
//       teamMembers.dispatchers.add(socket.id);
//       socket.join('dispatchers');
//       console.log(`🔌 Admin/Dispatcher joined dispatchers room: ${socket.id}`);
//     }

//     if (team && teamMembers[team]) {
//       teamMembers[team].add(socket.id);
//       socket.join(team);
//       console.log(`🔌 User joined ${team} room`);
//     }
//   }

//   function removeUserFromTeams(socketId) {
//     Object.values(teamMembers).forEach(team => team.delete(socketId));
//   }

//   function filterOrderForTeam(order, teamName) {
//     const isDecorationTeam = ['printing', 'coating', 'foiling', 'frosting'].includes(teamName);

//     return {
//       ...order,
//       item_ids: order.item_ids?.map(item => {
//         const assignment = item.team_assignments?.[teamName] || [];

//         if (isDecorationTeam && assignment.length > 0) {
//           const enrichedAssignments = assignment.map(deco => {
//             const glassEntry = findGlassEntry(order.item_ids, deco.glass_item_id);
//             return {
//               ...deco,
//               glass_name: glassEntry?.glass_name,
//               quantity: glassEntry?.quantity,
//               weight: glassEntry?.weight,
//               neck_size: glassEntry?.neck_size,
//               decoration_details: glassEntry?.decoration_details,
//               team_tracking: glassEntry?.team_tracking
//             };
//           });

//           return {
//             ...item,
//             team_assignments: {
//               [teamName]: enrichedAssignments
//             }
//           };
//         }

//         return {
//           ...item,
//           team_assignments: {
//             [teamName]: assignment
//           }
//         };
//       }).filter(item => item.team_assignments[teamName]?.length > 0) || []
//     };
//   }

//   function findGlassEntry(items, glassItemId) {
//     for (const item of items) {
//       const glassAssignments = item.team_assignments?.glass || [];
//       const match = glassAssignments.find(entry => entry._id === glassItemId);
//       if (match) return match;
//     }
//     return null;
//   }

//   function broadcastConnectedUsers() {
//     const dispatchersList = Array.from(teamMembers.dispatchers).map(socketId => {
//       const user = connectedUsers.get(socketId);
//       return {
//         userId: user?.userId || socketId,
//         connected: true
//       };
//     });

//     const teamLists = {};
//     const allTeamMembers = [];

//     ['glass', 'caps', 'boxes', 'pumps', 'printing', 'coating', 'foiling', 'frosting'].forEach(teamName => {
//       const teamUsers = Array.from(teamMembers[teamName]).map(socketId => {
//         const user = connectedUsers.get(socketId);
//         return {
//           userId: user?.userId || socketId,
//           team: teamName,
//           connected: true
//         };
//       });

//       teamLists[teamName] = teamUsers;
//       allTeamMembers.push(...teamUsers);
//     });

//     io.to('dispatchers').emit('connected-users', {
//       dispatchers: dispatchersList,
//       teamMembers: allTeamMembers,
//       teams: teamLists
//     });

//     // Send to each team
//     Object.keys(teamLists).forEach(teamName => {
//       if (teamMembers[teamName].size > 0) {
//         io.to(teamName).emit('connected-users', {
//           teamMembers: teamLists[teamName],
//           dispatchers: dispatchersList
//         });
//       }
//     });
//   }

//   socket.on('disconnect', () => {
//     console.log(`🔌 User disconnected: ${socket.id}`);
//     removeUserFromTeams(socket.id);
//     connectedUsers.delete(socket.id);
//     broadcastConnectedUsers();
//   });
// });

// const PORT = process.env.PORT || 5000;

// httpServer.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`);
// });


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

app.set('io', io); // ✅ Attach io to app

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

// Helper function to get the first team in decoration sequence
function getFirstTeamInSequence(decorationType) {
  const sequence = DECORATION_SEQUENCES[decorationType];
  return sequence && sequence.length > 0 ? sequence[0] : null;
}

// Helper function to get next team in sequence
function getNextTeamInSequence(decorationType, currentTeam) {
  const sequence = DECORATION_SEQUENCES[decorationType];
  if (!sequence) return null;

  const currentIndex = sequence.indexOf(currentTeam);
  if (currentIndex === -1 || currentIndex === sequence.length - 1) {
    return null; // No next team or team not found
  }

  return sequence[currentIndex + 1];
}

// Helper function to check if glass item is fully completed
function isGlassItemCompleted(glassItem) {
  const teamTracking = glassItem.team_tracking || {};
  const totalCompletedQty = teamTracking.total_completed_qty || 0;
  const requiredQty = glassItem.quantity || 0;

  console.log(`🔍 Checking glass completion: ${totalCompletedQty}/${requiredQty}`);
  return totalCompletedQty >= requiredQty;
}

// Helper function to check if decoration team item is fully completed
function isDecorationItemCompleted(decorationItem) {
  const teamTracking = decorationItem.team_tracking || {};
  const totalCompletedQty = teamTracking.total_completed_qty || 0;
  const requiredQty = decorationItem.quantity || 0;

  console.log(`🔍 Checking decoration completion: ${totalCompletedQty}/${requiredQty}`);
  return totalCompletedQty >= requiredQty;
}

function isOrderGlassCompleted(orderData) {
  let allGlassItems = [];

  // Collect all glass items from all order items
  orderData.item_ids?.forEach(item => {
    const glassAssignments = item.team_assignments?.glass || [];
    allGlassItems = [...allGlassItems, ...glassAssignments];
  });

  if (allGlassItems.length === 0) {
    console.log('❌ No glass items found in order');
    return false;
  }

  // Check if ALL glass items are completed
  const allCompleted = allGlassItems.every(glassItem => {
    const teamTracking = glassItem.team_tracking || {};
    const totalCompletedQty = teamTracking.total_completed_qty || 0;
    const requiredQty = glassItem.quantity || 0;
    const isCompleted = totalCompletedQty >= requiredQty;

    console.log(`🔍 Glass item ${glassItem._id}: ${totalCompletedQty}/${requiredQty} - ${isCompleted ? 'COMPLETED' : 'PENDING'}`);
    return isCompleted;
  });

  console.log(`🔍 Order ${orderData.order_number} glass completion status: ${allCompleted ? 'ALL COMPLETED' : 'SOME PENDING'}`);
  return allCompleted;
}

function isOrderDecorationTeamCompleted(orderData, teamName) {
  let allDecorationItems = [];

  // Collect all decoration items for the specific team from all order items
  orderData.item_ids?.forEach(item => {
    const decorationAssignments = item.team_assignments?.[teamName] || [];
    allDecorationItems = [...allDecorationItems, ...decorationAssignments];
  });

  if (allDecorationItems.length === 0) {
    console.log(`❌ No ${teamName} items found in order`);
    return false;
  }

  // Check if ALL decoration items for this team are completed
  const allCompleted = allDecorationItems.every(decorationItem => {
    const teamTracking = decorationItem.team_tracking || {};
    const totalCompletedQty = teamTracking.total_completed_qty || 0;
    const requiredQty = decorationItem.quantity || 0;
    const isCompleted = totalCompletedQty >= requiredQty;

    console.log(`🔍 ${teamName} item ${decorationItem._id}: ${totalCompletedQty}/${requiredQty} - ${isCompleted ? 'COMPLETED' : 'PENDING'}`);
    return isCompleted;
  });

  console.log(`🔍 Order ${orderData.order_number} ${teamName} completion status: ${allCompleted ? 'ALL COMPLETED' : 'SOME PENDING'}`);
  return allCompleted;
}

// Create assignment for decoration team from glass item
function createDecorationAssignment(glassItem, decorationTeam, decorationType) {
  return {
    _id: `${glassItem._id}_${decorationTeam}_${Date.now()}`, // Generate unique ID
    itemId: glassItem.itemId,
    orderNumber: glassItem.orderNumber,
    glass_item_id: glassItem._id,
    bottle: glassItem.glass_name, // Map glass_name to bottle for decoration teams
    quantity: glassItem.quantity,
    weight: glassItem.weight,
    neck_size: glassItem.neck_size,
    decoration: decorationType,
    decoration_no: glassItem.decoration_no,
    decoration_details: glassItem.decoration_details,
    team: `${decorationTeam.charAt(0).toUpperCase() + decorationTeam.slice(1)} Team`,
    status: "Pending",
    team_tracking: {
      total_completed_qty: 0,
      completed_entries: []
    }
  };
}

// Create assignment for next decoration team from current decoration item
function createNextDecorationAssignment(currentDecorationItem, nextTeam) {
  return {
    _id: `${currentDecorationItem.glass_item_id}_${nextTeam}_${Date.now()}`, // Generate unique ID
    itemId: currentDecorationItem.itemId,
    orderNumber: currentDecorationItem.orderNumber,
    glass_item_id: currentDecorationItem.glass_item_id,
    bottle: currentDecorationItem.bottle,
    quantity: currentDecorationItem.quantity,
    weight: currentDecorationItem.weight,
    neck_size: currentDecorationItem.neck_size,
    decoration: currentDecorationItem.decoration,
    decoration_no: currentDecorationItem.decoration_no,
    decoration_details: currentDecorationItem.decoration_details,
    team: `${nextTeam.charAt(0).toUpperCase() + nextTeam.slice(1)} Team`,
    status: "Pending",
    team_tracking: {
      total_completed_qty: 0,
      completed_entries: []
    }
  };
}

// Handle glass completion and trigger first decoration team
async function handleGlassCompletion(orderData, completedGlassItemId) {
  try {
    console.log(`🟢 Processing GLASS completion for item: ${completedGlassItemId}`);

    // First, check if the individual glass item is completed
    let completedGlassItem = null;
    let orderItem = null;

    for (const item of orderData.item_ids) {
      const glassAssignment = item.team_assignments.glass?.find(g => g._id === completedGlassItemId);
      if (glassAssignment) {
        completedGlassItem = glassAssignment;
        orderItem = item;
        break;
      }
    }

    if (!completedGlassItem || !orderItem) {
      console.log(`❌ Completed glass item not found for ${completedGlassItemId}`);
      return;
    }

    // Check if this specific glass item is completed
    if (!isGlassItemCompleted(completedGlassItem)) {
      console.log(`⏳ Glass item not fully completed - ${completedGlassItem.team_tracking?.total_completed_qty || 0}/${completedGlassItem.quantity}`);
      return;
    }

    // 🔥 NEW: Check if ALL glass items in the entire order are completed
    if (!isOrderGlassCompleted(orderData)) {
      console.log(`⏳ Order glass not fully completed - waiting for all glass items to finish`);
      return;
    }

    console.log(`✅ ALL glass items completed for order ${orderData.order_number} - triggering sequential workflow`);

    // Now process all completed glass items for sequential workflow
    const allCompletedGlassItems = [];
    orderData.item_ids?.forEach(item => {
      const glassAssignments = item.team_assignments?.glass || [];
      glassAssignments.forEach(glassItem => {
        if (isGlassItemCompleted(glassItem)) {
          allCompletedGlassItems.push({ glassItem, orderItem: item });
        }
      });
    });

    // Group glass items by decoration type
    const decorationGroups = {};
    allCompletedGlassItems.forEach(({ glassItem, orderItem }) => {
      const decorationType = glassItem.decoration;
      if (!decorationType) return;

      if (!decorationGroups[decorationType]) {
        decorationGroups[decorationType] = [];
      }
      decorationGroups[decorationType].push({ glassItem, orderItem });
    });

    // Process each decoration type
    for (const [decorationType, items] of Object.entries(decorationGroups)) {
      const firstDecorationTeam = getFirstTeamInSequence(decorationType);
      if (!firstDecorationTeam) {
        console.log(`❌ No decoration sequence found for ${decorationType}`);
        continue;
      }

      console.log(`➡️ Creating ${firstDecorationTeam} assignments for decoration: ${decorationType}`);

      // Create assignments for all items of this decoration type
      items.forEach(({ glassItem, orderItem }) => {
        const decorationAssignment = createDecorationAssignment(
          glassItem,
          firstDecorationTeam,
          decorationType
        );

        // Add the assignment to the order structure
        if (!orderItem.team_assignments[firstDecorationTeam]) {
          orderItem.team_assignments[firstDecorationTeam] = [];
        }
        orderItem.team_assignments[firstDecorationTeam].push(decorationAssignment);
      });

      const notificationData = {
        type: 'sequential-assignment',
        orderNumber: orderData.order_number,
        customerName: orderData.customer_name,
        dispatcherName: orderData.dispatcher_name,
        fromTeam: 'GLASS',
        toTeam: firstDecorationTeam.toUpperCase(),
        timestamp: new Date().toISOString(),
        orderData: orderData,
        decorationType: decorationType,
        itemCount: items.length,
        message: `New ${decorationType} assignments from GLASS team - ${items.length} items ready`
      };

      // Send to decoration team
      if (teamMembers[firstDecorationTeam] && teamMembers[firstDecorationTeam].size > 0) {
        io.to(firstDecorationTeam).emit('new-sequential-assignment', notificationData);
        console.log(`📤 Sequential assignment sent to ${firstDecorationTeam} team for ${items.length} items`);
      }

      // Also notify dispatchers
      io.to('dispatchers').emit('sequential-assignment-created', notificationData);
    }

  } catch (error) {
    console.error('Error handling glass completion:', error);
  }
}

async function handleDecorationCompletion(orderData, completedTeam, completedItemId) {
  try {
    console.log(`🎨 Processing DECORATION completion for ${completedTeam} team, item: ${completedItemId}`);

    // Find the completed decoration item
    let completedDecorationItem = null;
    let orderItem = null;

    for (const item of orderData.item_ids) {
      const decorationAssignment = item.team_assignments[completedTeam]?.find(d => d._id === completedItemId);
      if (decorationAssignment) {
        completedDecorationItem = decorationAssignment;
        orderItem = item;
        break;
      }
    }

    if (!completedDecorationItem || !orderItem) {
      console.log(`❌ Completed decoration item not found for ${completedItemId}`);
      return;
    }

    // Check if decoration item is truly completed
    if (!isDecorationItemCompleted(completedDecorationItem)) {
      console.log(`⏳ Decoration item not fully completed - ${completedDecorationItem.team_tracking?.total_completed_qty || 0}/${completedDecorationItem.quantity}`);
      return;
    }

    // 🔥 NEW: Check if ALL items for this decoration team are completed
    if (!isOrderDecorationTeamCompleted(orderData, completedTeam)) {
      console.log(`⏳ Order ${completedTeam} not fully completed - waiting for all ${completedTeam} items to finish`);
      return;
    }

    console.log(`✅ ALL ${completedTeam} items completed for order ${orderData.order_number} - checking for next team`);

    // Get decoration type and find next decoration team
    const decorationType = completedDecorationItem.decoration;
    const nextTeam = getNextTeamInSequence(decorationType, completedTeam);

    if (!nextTeam) {
      console.log(`✅ No next decoration team - sequence completed for ${decorationType}`);
      return;
    }

    console.log(`➡️ Next decoration team: ${nextTeam}`);

    // Get all completed items for this decoration team with the same decoration type
    const allCompletedItems = [];
    orderData.item_ids?.forEach(item => {
      const decorationAssignments = item.team_assignments?.[completedTeam] || [];
      decorationAssignments.forEach(decorationItem => {
        if (decorationItem.decoration === decorationType && isDecorationItemCompleted(decorationItem)) {
          allCompletedItems.push({ decorationItem, orderItem: item });
        }
      });
    });

    // Create assignments for next decoration team
    allCompletedItems.forEach(({ decorationItem, orderItem }) => {
      const nextDecorationAssignment = createNextDecorationAssignment(
        decorationItem,
        nextTeam
      );

      // Add the assignment to the order structure
      if (!orderItem.team_assignments[nextTeam]) {
        orderItem.team_assignments[nextTeam] = [];
      }
      orderItem.team_assignments[nextTeam].push(nextDecorationAssignment);
    });

    const notificationData = {
      type: 'sequential-assignment',
      orderNumber: orderData.order_number,
      customerName: orderData.customer_name,
      dispatcherName: orderData.dispatcher_name,
      fromTeam: completedTeam.toUpperCase(),
      toTeam: nextTeam.toUpperCase(),
      timestamp: new Date().toISOString(),
      orderData: orderData,
      decorationType: decorationType,
      itemCount: allCompletedItems.length,
      message: `New assignments from ${completedTeam.toUpperCase()} team - ${allCompletedItems.length} items ready`
    };

    // Send to next decoration team
    if (teamMembers[nextTeam] && teamMembers[nextTeam].size > 0) {
      io.to(nextTeam).emit('new-sequential-assignment', notificationData);
      console.log(`📤 Sequential assignment sent to ${nextTeam} team for ${allCompletedItems.length} items`);
    }

    // Also notify dispatchers
    io.to('dispatchers').emit('sequential-assignment-created', notificationData);

  } catch (error) {
    console.error('Error handling decoration completion:', error);
  }
}

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

      io.to('dispatchers').emit('new-order', {
        ...baseNotification,
        orderData: order
      });

      assignedTeams.forEach(teamName => {
  // Only allow non-decoration teams to receive order immediately
  const isDecorationTeam = ['coating', 'printing', 'foiling', 'frosting'].includes(teamName);
  if (isDecorationTeam) return;

  if (teamMembers[teamName] && teamMembers[teamName].size > 0) {
    const filteredOrder = filterOrderForTeam(order, teamName);

    io.to(teamName).emit('new-order', {
      ...baseNotification,
      message: `New order #${orderNumber} assigned to ${teamName.toUpperCase()} team`,
      orderData: filteredOrder
    });

    console.log(`📤 Filtered order sent to ${teamName} team`);
  }
});


    } catch (error) {
      console.error('Error handling order notification:', error);
    }
  });

  socket.on('team-progress-updated', (progressData) => {
    console.log('📈 Team progress update received:', {
      order: progressData.orderNumber,
      team: progressData.team,
      item: progressData.itemName,
      isFullyCompleted: progressData.isFullyCompleted
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
        timestamp,
        completedItemId,
        isFullyCompleted = false
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

      // Send to all dispatchers (admins)
      io.to('dispatchers').emit('team-progress-updated', notificationData);
      socket.broadcast.emit('team-progress-updated', notificationData);

      // Handle sequential workflow ONLY if item is fully completed
      if (isFullyCompleted && completedItemId) {
        const teamLower = team.toLowerCase();

        if (teamLower === 'glass') {
          // Glass completion - trigger first decoration team
          handleGlassCompletion(updatedOrder, completedItemId);
        } else if (['coating', 'printing', 'foiling', 'frosting'].includes(teamLower)) {
          // Decoration team completion - trigger next decoration team
          handleDecorationCompletion(updatedOrder, teamLower, completedItemId);
        }
      }

      console.log(`📤 Progress update sent to dispatchers for order #${orderNumber}`);

    } catch (error) {
      console.error('Error handling team progress update:', error);
    }
  });

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

          console.log(`📤 Updated order sent to ${teamName} team (hasAssignments: ${hasCurrentAssignments})`);
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

      console.log(`📤 Order delete notification sent to all teams and dispatchers`);

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




