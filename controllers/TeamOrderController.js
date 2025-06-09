import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import GlassItem from '../models/GlassItem.js';
import CapItem from '../models/CapItem.js';
import BoxItem from '../models/BoxItem.js';
import PumpItem from '../models/PumpItem.js';
import mongoose from 'mongoose';

// GET /api/team-orders?team=Box%20Team&created_by=anita_singh&orderType=pending
export const getAllOrders = async (req, res) => {
  try {
    const { team, created_by, orderType } = req.query;

    if (!team || !created_by) {
      return res.status(400).json({
        success: false,
        message: 'Team and created_by are required',
      });
    }

    const filter = {
      team,
      created_by, // filter orders by the logged-in user
    };

    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }

    const orders = await Order.find(filter).populate({
      path: 'item_ids',
      populate: {
        path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
      },
    });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error('Error fetching team orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
    });
  }
};



export const getOrderById = async (req, res, next) => {
  try {
    const { team, user } = req.query;
    
    // Create filter for team and user
    let filter = { _id: req.params.id };
    if (team) filter.team = team;
    if (user) filter.created_by = user;
    
    // DEBUG: Log the filter for getOrderById
    console.log('getOrderById Filter:', filter);
    
    const order = await Order.findOne(filter)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or you do not have permission to view this order' 
      });
    }
    
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found with invalid ID format' 
      });
    }
    next(error);
  }
};

export const getOrderByNumber = async (req, res, next) => {
  try {
    const { orderNumber } = req.params;
    const { team, user } = req.query;
    
    // Create filter for team and user
    let filter = { order_number: orderNumber };
    if (team) filter.team = team;
    if (user) filter.created_by = user;
    
    // DEBUG: Log the filter for getOrderByNumber
    console.log('getOrderByNumber Filter:', filter);
    
    const order = await Order.findOne(filter)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found with this number or you do not have permission to view this order' 
      });
    }
    
    // Transform the data to match your frontend expectations
    const transformedOrder = {
      ...order.toObject(),
      items: order.item_ids.map(item => ({
        name: item.name,
        glass: item.team_assignments.glass || [],
        caps: item.team_assignments.caps || [],
        boxes: item.team_assignments.boxes || [],
        pumps: item.team_assignments.pumps || []
      }))
    };
    
    res.status(200).json({ 
      success: true, 
      data: transformedOrder 
    });
  } catch (error) {
    console.error('Error fetching team order by number:', error);
    next(error);
  }
};

export const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  console.log('Request body:', req.body); 
  console.log('Team:', req.body.team, 'Created_by:', req.body.created_by);

  try {
    const { order_number, dispatcher_name, customer_name, team, created_by, items = [] } = req.body;

    if (!order_number || !dispatcher_name || !customer_name || !team || !created_by) {
      return res.status(400).json({
        success: false,
        message: 'order_number, dispatcher_name, customer_name, team, and created_by are required',
      });
    }

    const orderExists = await Order.findOne({ order_number, team });
    if (orderExists) {
      return res.status(400).json({
        success: false,
        message: `Order number ${order_number} already exists for team ${team}`,
      });
    }

    const newOrder = new Order({
      order_number,
      dispatcher_name,
      customer_name,
      team,
      created_by,
      order_status: req.body.order_status || 'Pending',
      item_ids: [],
    });

    await newOrder.save({ session });

    const itemIds = [];

    for (const item of items) {
      const orderItem = new OrderItem({
        order_number,
        name: item.name || `Item for ${order_number}`,
        team_assignments: {
          glass: [],
          caps: [],
          boxes: [],
          pumps: [],
          marketing: [], // Keep this as part of OrderItem schema
        },
      });

      await orderItem.save({ session });
      itemIds.push(orderItem._id);

      // Save glass items
      if (item.glass?.length) {
        for (const g of item.glass) {
          const glassItem = new GlassItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            glass_name: g.glass_name,
            quantity: g.quantity,
            weight: g.weight,
            neck_size: g.neck_size,
            decoration: g.decoration,
            decoration_no: g.decoration_no,
            decoration_details: g.decoration_details,
            team: g.team || 'Glass',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' },
          });
          await glassItem.save({ session });
          orderItem.team_assignments.glass.push(glassItem._id);
        }
      }

      // Save caps
      if (item.caps?.length) {
        for (const c of item.caps) {
          const capItem = new CapItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            cap_name: c.cap_name,
            neck_size: c.neck_size,
            quantity: c.quantity,
            process: c.process,
            material: c.material,
            team: c.team || 'Caps',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' },
          });
          await capItem.save({ session });
          orderItem.team_assignments.caps.push(capItem._id);
        }
      }

      // Save boxes
      if (item.boxes?.length) {
        for (const b of item.boxes) {
          const boxItem = new BoxItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            box_name: b.box_name,
            quantity: b.quantity,
            approval_code: b.approval_code,
            team: b.team || 'Boxes',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' },
          });
          await boxItem.save({ session });
          orderItem.team_assignments.boxes.push(boxItem._id);
        }
      }

      // Save pumps
      if (item.pumps?.length) {
        for (const p of item.pumps) {
          const pumpItem = new PumpItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            pump_name: p.pump_name,
            neck_type: p.neck_type,
            quantity: p.quantity,
            team: p.team || 'Pumps',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' },
          });
          await pumpItem.save({ session });
          orderItem.team_assignments.pumps.push(pumpItem._id);
        }
      }

      // Handle marketing items - store directly in OrderItem schema, not as separate model
      if (item.marketing?.length) {
        const marketingItems = item.marketing.map(m => ({
          marketing_name: m.marketing_name,
          quantity: m.quantity,
          campaign_type: m.campaign_type,
          target_audience: m.target_audience,
          budget: m.budget,
          timeline: m.timeline,
          team: m.team || 'Marketing',
          status: 'Pending',
          team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' },
        }));
        
        orderItem.team_assignments.marketing = marketingItems;
      }

      await orderItem.save({ session });
    }

    newOrder.item_ids = itemIds;
    await newOrder.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Populate for returning full details
    const populatedOrder = await Order.findById(newOrder._id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });

    res.status(201).json({
      success: true,
      message: 'Team order created successfully',
      data: populatedOrder,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error('Error creating order:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate key error: Order number must be unique within the team.',
      });
    }

    // Log validation errors for debugging
    if (error.name === 'ValidationError') {
      console.error('Validation Error Details:', error.errors);
      return res.status(400).json({
        success: false,
        message: 'Validation Error: ' + Object.keys(error.errors).map(key => `${key}: ${error.errors[key].message}`).join(', '),
      });
    }

    next(error);
  }
};


// ... (rest of the functions remain the same as your original code)

export const updateOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
      order_number, 
      dispatcher_name, 
      customer_name, 
      order_status,
      team,
      created_by,
      items = [] 
    } = req.body;

    // Create filter for team and user permissions
    let filter = { _id: req.params.id };
    if (req.query.team) filter.team = req.query.team;
    if (req.query.user) filter.created_by = req.query.user;

    // Find the existing order with populated data
    const existingOrder = await Order.findOne(filter)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
      
    if (!existingOrder) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or you do not have permission to update this order' 
      });
    }

    // Store the OLD order number before updating
    const oldOrderNumber = existingOrder.order_number;

    // Check if new order number conflicts with other orders in the same team
    if (order_number && order_number !== oldOrderNumber) {
      const orderExists = await Order.findOne({ 
        order_number, 
        team: existingOrder.team,
        _id: { $ne: req.params.id } 
      });
      if (orderExists) {
        return res.status(400).json({
          success: false,
          message: `Order with number ${order_number} already exists in team ${existingOrder.team}`
        });
      }
    }

    // Preserve existing tracking data
    const existingTrackingData = new Map();
    
    if (existingOrder.item_ids) {
      existingOrder.item_ids.forEach(item => {
        const itemKey = item.name;
        existingTrackingData.set(itemKey, {
          glass: {},
          caps: {},
          boxes: {},
          pumps: {}
        });
        
        ['glass', 'caps', 'boxes', 'pumps'].forEach(teamType => {
          if (item.team_assignments?.[teamType]) {
            item.team_assignments[teamType].forEach(assignment => {
              const assignmentKey = getAssignmentKey(assignment, teamType);
              existingTrackingData.get(itemKey)[teamType][assignmentKey] = {
                team_tracking: assignment.team_tracking,
                status: assignment.status
              };
            });
          }
        });
      });
    }

    function getAssignmentKey(assignment, teamType) {
      switch (teamType) {
        case 'glass':
          return `${assignment.glass_name}_${assignment.neck_size}_${assignment.decoration}`;
        case 'caps':
          return `${assignment.cap_name}_${assignment.neck_size}_${assignment.material}`;
        case 'boxes':
          return `${assignment.box_name}_${assignment.approval_code}`;
        case 'pumps':
          return `${assignment.pump_name}_${assignment.neck_type}`;
        default:
          return assignment.name || 'default';
      }
    }

    // Update order basic info (preserve team and created_by unless explicitly changed)
    existingOrder.order_number = order_number || existingOrder.order_number;
    existingOrder.dispatcher_name = dispatcher_name || existingOrder.dispatcher_name;
    existingOrder.customer_name = customer_name || existingOrder.customer_name;
    existingOrder.order_status = order_status || existingOrder.order_status;
    existingOrder.team = team || existingOrder.team;
    existingOrder.created_by = created_by || existingOrder.created_by;

    // Delete OrderItems using the OLD order number
    const existingOrderItems = await OrderItem.find({ order_number: oldOrderNumber });
    
    for (const item of existingOrderItems) {
      await GlassItem.deleteMany({ itemId: item._id }, { session });
      await CapItem.deleteMany({ itemId: item._id }, { session });
      await BoxItem.deleteMany({ itemId: item._id }, { session });
      await PumpItem.deleteMany({ itemId: item._id }, { session });
      await item.deleteOne({ session });
    }

    // Clear the item_ids array
    existingOrder.item_ids = [];

    // Create new order items with NEW order number and preserved tracking data
    const itemIds = [];

    for (const item of items) {
      const orderItem = new OrderItem({
        order_number: existingOrder.order_number,
        name: item.name || `Item for ${existingOrder.order_number}`,
        team_assignments: {
          glass: [],
          caps: [],
          boxes: [],
          pumps: []
        }
      });
      
      await orderItem.save({ session });
      itemIds.push(orderItem._id);

      const existingItemTracking = existingTrackingData.get(item.name) || {
        glass: {}, caps: {}, boxes: {}, pumps: {}
      };

      // Handle Glass Items with preserved tracking
      if (item.glass && item.glass.length > 0) {
        for (const glassData of item.glass) {
          const assignmentKey = getAssignmentKey(glassData, 'glass');
          const existingTracking = existingItemTracking.glass[assignmentKey];
          
          const glassItem = new GlassItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            glass_name: glassData.glass_name,
            quantity: glassData.quantity,
            weight: glassData.weight,
            neck_size: glassData.neck_size,
            decoration: glassData.decoration,
            decoration_no: glassData.decoration_no,
            decoration_details: glassData.decoration_details,
            team: glassData.team || 'Glass Manufacturing - Mumbai',
            status: existingTracking?.status || glassData.status || 'Pending',
            team_tracking: existingTracking?.team_tracking || glassData.team_tracking || {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await glassItem.save({ session });
          orderItem.team_assignments.glass.push(glassItem._id);
        }
      }
      
      // Handle Cap Items with preserved tracking
      if (item.caps && item.caps.length > 0) {
        for (const capData of item.caps) {
          const assignmentKey = getAssignmentKey(capData, 'caps');
          const existingTracking = existingItemTracking.caps[assignmentKey];
          
          const capItem = new CapItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            cap_name: capData.cap_name,
            neck_size: capData.neck_size,
            quantity: capData.quantity,
            process: capData.process,
            material: capData.material,
            team: capData.team || 'Cap Manufacturing - Delhi',
            status: existingTracking?.status || capData.status || 'Pending',
            team_tracking: existingTracking?.team_tracking || capData.team_tracking || {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await capItem.save({ session });
          orderItem.team_assignments.caps.push(capItem._id);
        }
      }
      
      // Handle Box Items with preserved tracking
      if (item.boxes && item.boxes.length > 0) {
        for (const boxData of item.boxes) {
          const assignmentKey = getAssignmentKey(boxData, 'boxes');
          const existingTracking = existingItemTracking.boxes[assignmentKey];
          
          const boxItem = new BoxItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            box_name: boxData.box_name,
            quantity: boxData.quantity,
            approval_code: boxData.approval_code,
            team: boxData.team || 'Box Manufacturing - Pune',
            status: existingTracking?.status || boxData.status || 'Pending',
            team_tracking: existingTracking?.team_tracking || boxData.team_tracking || {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await boxItem.save({ session });
          orderItem.team_assignments.boxes.push(boxItem._id);
        }
      }
      
      // Handle Pump Items with preserved tracking
      if (item.pumps && item.pumps.length > 0) {
        for (const pumpData of item.pumps) {
          const assignmentKey = getAssignmentKey(pumpData, 'pumps');
          const existingTracking = existingItemTracking.pumps[assignmentKey];
          
          const pumpItem = new PumpItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            pump_name: pumpData.pump_name,
            neck_type: pumpData.neck_type,
            quantity: pumpData.quantity,
            team: pumpData.team || 'Pump Manufacturing - Chennai',
            status: existingTracking?.status || pumpData.status || 'Pending',
            team_tracking: existingTracking?.team_tracking || pumpData.team_tracking || {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await pumpItem.save({ session });
          orderItem.team_assignments.pumps.push(pumpItem._id);
        }
      }
      
      await orderItem.save({ session });
    }

    // Update the order with new item IDs
    existingOrder.item_ids = itemIds;
    await existingOrder.save({ session });
    
    await session.commitTransaction();
    session.endSession();

    // Fetch the fully populated updated order
    const populatedOrder = await Order.findById(existingOrder._id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
    
    res.status(200).json({ 
      success: true, 
      message: 'Team order updated successfully',
      data: populatedOrder 
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate key error. Order number must be unique within the team.'
      });
    }
    
    next(error);
  }
};

export const deleteOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { team, user } = req.query;
    
    // Create filter for team and user permissions
    let filter = { _id: req.params.id };
    if (team) filter.team = team;
    if (user) filter.created_by = user;
    
    const order = await Order.findOne(filter);
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or you do not have permission to delete this order' 
      });
    }
    
    const orderItems = await OrderItem.find({ order_number: order.order_number });
    
    for (const item of orderItems) {
      await GlassItem.deleteMany({ itemId: item._id }, { session });
      await CapItem.deleteMany({ itemId: item._id }, { session });      
      await BoxItem.deleteMany({ itemId: item._id }, { session });
      await PumpItem.deleteMany({ itemId: item._id }, { session });
      await item.deleteOne({ session });
    }
    await order.deleteOne({ session });
    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({ 
      success: true, 
      message: 'Team order deleted successfully' 
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const createOrderItem = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { order_id } = req.params;
    const { team, user } = req.query;
    
    // Create filter for team and user permissions
    let filter = { _id: order_id };
    if (team) filter.team = team;
    if (user) filter.created_by = user;
    
    const order = await Order.findOne(filter);
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or you do not have permission to modify this order' 
      });
    }
    
    const orderItem = new OrderItem({
      ...req.body,
      order_number: order.order_number,
      team_assignments: {
        glass: [],
        caps: [],
        boxes: [],
        pumps: []
      }
    });
    
    await orderItem.save({ session });
    
    order.item_ids.push(orderItem._id);
    await order.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    const populatedItem = await OrderItem.findById(orderItem._id)
      .populate('team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps');
    
    res.status(201).json({ 
      success: true, 
      data: populatedItem 
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};