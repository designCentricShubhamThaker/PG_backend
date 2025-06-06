import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import GlassItem from '../models/GlassItem.js';
import CapItem from '../models/CapItem.js';
import BoxItem from '../models/BoxItem.js';
import PumpItem from '../models/PumpItem.js';
import mongoose from 'mongoose';

const filterOrdersByUser = (orders, user) => {
  return orders.filter(order => {
    return order.item_ids.some(item => {

      const hasGlass = item.team_assignments?.glass?.some(g => 
        g.assigned_user === user
      );
      const hasCaps = item.team_assignments?.caps?.some(c => 
        c.assigned_user === user
      );
      const hasBoxes = item.team_assignments?.boxes?.some(b => 
        b.assigned_user === user
      );
      const hasPumps = item.team_assignments?.pumps?.some(p => 
        p.assigned_user === user
      );
      
      return hasGlass || hasCaps || hasBoxes || hasPumps;
    });
  });
};

export const getAllOrders = async (req, res, next) => {
  try {
    const user = req.user?.user;
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information is required' 
      });
    }
    
    const { orderType } = req.query;
    
    let filter = {};
    
    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }
    
    const allOrders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });

    const userOrders = filterOrdersByUser(allOrders, user);

    res.status(200).json({ 
      success: true, 
      count: userOrders.length, 
      data: userOrders 
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const user = req.user?.user;
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information is required' 
      });
    }

    const order = await Order.findById(req.params.id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if user has access to this order
    const userOrders = filterOrdersByUser([order], user);
    if (userOrders.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. No assignments found for your user in this order.' 
      });
    }
    
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ success: false, message: 'Order not found with invalid ID format' });
    }
    next(error);
  }
};

export const getOrderByNumber = async (req, res, next) => {
  try {
    const user = req.user?.user;
    const { orderNumber } = req.params;
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information is required' 
      });
    }
    
    const order = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found with this number' 
      });
    }

    // Check if user has access to this order
    const userOrders = filterOrdersByUser([order], user);
    if (userOrders.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. No assignments found for your user in this order.' 
      });
    }

    // Transform order to show only user's assignments
    const transformedOrder = {
      ...order.toObject(),
      items: order.item_ids.map(item => ({
        name: item.name,
        glass: item.team_assignments.glass?.filter(g => 
          g.assigned_user === user
        ) || [],
        caps: item.team_assignments.caps?.filter(c => 
          c.assigned_user === user
        ) || [],
        boxes: item.team_assignments.boxes?.filter(b => 
          b.assigned_user === user
        ) || [],
        pumps: item.team_assignments.pumps?.filter(p => 
          p.assigned_user === user
        ) || []
      }))
    };
    
    res.status(200).json({ 
      success: true, 
      data: transformedOrder 
    });
  } catch (error) {
    console.error('Error fetching order by number:', error);
    next(error);
  }
};

export const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user?.user;
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information is required' 
      });
    }

    const { 
      order_number, 
      dispatcher_name, 
      customer_name, 
      items = [] 
    } = req.body;

    if (!order_number || !dispatcher_name || !customer_name) {
      return res.status(400).json({
        success: false,
        message: 'Please provide order_number, dispatcher_name, and customer_name'
      });
    }

    const orderExists = await Order.findOne({ order_number });
    if (orderExists) {
      return res.status(400).json({
        success: false,
        message: `Order with number ${order_number} already exists`
      });
    }

    const newOrder = new Order({
      order_number,
      dispatcher_name,
      customer_name,
      order_status: req.body.order_status || 'Pending',
      item_ids: []
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
          pumps: []
        }
      });
      
      await orderItem.save({ session });
      itemIds.push(orderItem._id);

      // Create glass assignments
      if (item.glass && item.glass.length > 0) {
        for (const glassData of item.glass) {
          const glassItem = new GlassItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            glass_name: glassData.glass_name,
            quantity: glassData.quantity,
            weight: glassData.weight,
            neck_size: glassData.neck_size,
            decoration: glassData.decoration,
            decoration_no: glassData.decoration_no,
            decoration_details: glassData.decoration_details,
            team: glassData.team || 'Glass',
            assigned_user: user,
            status: 'Pending',
            team_tracking: {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await glassItem.save({ session });
          orderItem.team_assignments.glass.push(glassItem._id);
        }
      }
      
      // Create caps assignments
      if (item.caps && item.caps.length > 0) {
        for (const capData of item.caps) {
          const capItem = new CapItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            cap_name: capData.cap_name,
            neck_size: capData.neck_size,
            quantity: capData.quantity,
            process: capData.process,
            material: capData.material,
            team: capData.team || 'Cap',
            assigned_user: user,
            status: 'Pending',
            team_tracking: {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await capItem.save({ session });
          orderItem.team_assignments.caps.push(capItem._id);
        }
      }
      
      // Create boxes assignments
      if (item.boxes && item.boxes.length > 0) {
        for (const boxData of item.boxes) {
          const boxItem = new BoxItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            box_name: boxData.box_name,
            quantity: boxData.quantity,
            approval_code: boxData.approval_code,
            team: boxData.team || 'Box',
            assigned_user: user,
            status: 'Pending',
            team_tracking: {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });
          
          await boxItem.save({ session });
          orderItem.team_assignments.boxes.push(boxItem._id);
        }
      }
      
      // Create pumps assignments
      if (item.pumps && item.pumps.length > 0) {
        for (const pumpData of item.pumps) {
          const pumpItem = new PumpItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            pump_name: pumpData.pump_name,
            neck_type: pumpData.neck_type,
            quantity: pumpData.quantity,
            team: pumpData.team || 'Pump',
            assigned_user: user,
            status: 'Pending',
            team_tracking: {
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
  
    newOrder.item_ids = itemIds;
    await newOrder.save({ session });
    
    await session.commitTransaction();
    session.endSession();

    // Fetch the fully populated order after creation
    const populatedOrder = await Order.findById(newOrder._id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
    
    res.status(201).json({ 
      success: true, 
      message: 'Order created successfully',
      data: populatedOrder 
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate key error. Order number must be unique.'
      });
    }
    
    next(error);
  }
};

export const updateOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user?.user;
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information is required' 
      });
    }

    const { 
      order_number, 
      dispatcher_name, 
      customer_name, 
      order_status,
      items = [] 
    } = req.body;

    // Find the existing order with populated data
    const existingOrder = await Order.findById(req.params.id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });
      
    if (!existingOrder) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if user has access to this order
    const userOrders = filterOrdersByUser([existingOrder], user);
    if (userOrders.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. No assignments found for your user in this order.' 
      });
    }

    // Store the OLD order number before updating
    const oldOrderNumber = existingOrder.order_number;

    // Check if new order number conflicts with other orders
    if (order_number && order_number !== oldOrderNumber) {
      const orderExists = await Order.findOne({ 
        order_number, 
        _id: { $ne: req.params.id } 
      });
      if (orderExists) {
        return res.status(400).json({
          success: false,
          message: `Order with number ${order_number} already exists`
        });
      }
    }

    // Preserve existing tracking data for this user
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
              // Preserve tracking data only for this user
              if (assignment.assigned_user === user) {
                const assignmentKey = getAssignmentKey(assignment, teamType);
                existingTrackingData.get(itemKey)[teamType][assignmentKey] = {
                  team_tracking: assignment.team_tracking,
                  status: assignment.status
                };
              }
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

    // Update order basic info
    existingOrder.order_number = order_number || existingOrder.order_number;
    existingOrder.dispatcher_name = dispatcher_name || existingOrder.dispatcher_name;
    existingOrder.customer_name = customer_name || existingOrder.customer_name;
    existingOrder.order_status = order_status || existingOrder.order_status;

    // Delete only this user's assignments
    const existingOrderItems = await OrderItem.find({ order_number: oldOrderNumber });
    
    for (const item of existingOrderItems) {
      await GlassItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
      await CapItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
      await BoxItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
      await PumpItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
    }

    // Create new assignments
    for (const item of items) {
      let orderItem = await OrderItem.findOne({ order_number: existingOrder.order_number, name: item.name });
      
      if (!orderItem) {
        orderItem = new OrderItem({
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
        existingOrder.item_ids.push(orderItem._id);
      }

      const existingItemTracking = existingTrackingData.get(item.name) || {
        glass: {}, caps: {}, boxes: {}, pumps: {}
      };

      // Handle glass assignments with preserved tracking
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
            team: glassData.team || 'Glass',
            assigned_user: user,
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
      
      // Handle caps assignments
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
            team: capData.team || 'Cap',
            assigned_user: user,
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
      
      // Handle boxes assignments
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
            team: boxData.team || 'Box',
            assigned_user: user,
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
      
      // Handle pumps assignments
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
            team: pumpData.team || 'Pump',
            assigned_user: user,
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
      message: 'Order updated successfully',
      data: populatedOrder 
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate key error. Order number must be unique.'
      });
    }
    
    next(error);
  }
};

export const deleteOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const user = req.user?.user;
    
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information is required' 
      });
    }

    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if user has access to this order
    const populatedOrder = await Order.findById(req.params.id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
        },
      });

    const userOrders = filterOrdersByUser([populatedOrder], user);
    if (userOrders.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. No assignments found for your user in this order.' 
      });
    }

    // User can only delete their own assignments
    const orderItems = await OrderItem.find({ order_number: order.order_number });
    
    for (const item of orderItems) {
      await GlassItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
      await CapItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
      await BoxItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
      await PumpItem.deleteMany({ itemId: item._id, assigned_user: user }, { session });
    }

    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({ 
      success: true, 
      message: 'Your assignments deleted successfully' 
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
    const userInfo = {
      user: req.user?.user,
      role: req.user?.role
    };
    const { order_id } = req.params;
    
    if (!userInfo.user || !userInfo.role) {
      return res.status(400).json({ 
        success: false, 
        message: 'User information (user, role) is required' 
      });
    }

    const order = await Order.findById(order_id);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check access based on role
    if (userInfo.role !== 'admin' && userInfo.role !== 'dispatcher') {
      const populatedOrder = await Order.findById(order_id)
        .populate({
          path: 'item_ids',
          populate: {
            path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps',
          },
        });

      const userOrders = filterOrdersByUser([populatedOrder], userInfo);
      if (userOrders.length === 0) {
        return res.status(403).json({ 
          success: false, 
         message: 'Access denied. No assignments found for your user in this order.' 
        });
      }
    }

    const { 
      name,
      glass = [],
      caps = [],
      boxes = [],
      pumps = []
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Item name is required'
      });
    }

    const orderItem = new OrderItem({
      order_number: order.order_number,
      name,
      team_assignments: {
        glass: [],
        caps: [],
        boxes: [],
        pumps: []
      }
    });
    
    await orderItem.save({ session });


    if (glass.length > 0) {
      for (const glassData of glass) {
        const glassItem = new GlassItem({
          itemId: orderItem._id,
          orderNumber: order.order_number,
          glass_name: glassData.glass_name,
          quantity: glassData.quantity,
          weight: glassData.weight,
          neck_size: glassData.neck_size,
          decoration: glassData.decoration,
          decoration_no: glassData.decoration_no,
          decoration_details: glassData.decoration_details,
          team: glassData.team || 'Glass',
          assigned_user: glassData.assigned_user || (userInfo.role === 'team' ? userInfo.user : null),
          status: 'Pending',
          team_tracking: {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        
        await glassItem.save({ session });
        orderItem.team_assignments.glass.push(glassItem._id);
      }
    }
    
    if (caps.length > 0) {
      for (const capData of caps) {
        const capItem = new CapItem({
          itemId: orderItem._id,
          orderNumber: order.order_number,
          cap_name: capData.cap_name,
          neck_size: capData.neck_size,
          quantity: capData.quantity,
          process: capData.process,
          material: capData.material,
          team: capData.team || 'Cap',
          assigned_user: capData.assigned_user || (userInfo.role === 'team' ? userInfo.user : null),
          status: 'Pending',
          team_tracking: {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        
        await capItem.save({ session });
        orderItem.team_assignments.caps.push(capItem._id);
      }
    }
    
    if (boxes.length > 0) {
      for (const boxData of boxes) {
        const boxItem = new BoxItem({
          itemId: orderItem._id,
          orderNumber: order.order_number,
          box_name: boxData.box_name,
          quantity: boxData.quantity,
          approval_code: boxData.approval_code,
          team: boxData.team || 'Box',
          assigned_user: boxData.assigned_user || (userInfo.role === 'team' ? userInfo.user : null),
          status: 'Pending',
          team_tracking: {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        
        await boxItem.save({ session });
        orderItem.team_assignments.boxes.push(boxItem._id);
      }
    }
    
    if (pumps.length > 0) {
      for (const pumpData of pumps) {
        const pumpItem = new PumpItem({
          itemId: orderItem._id,
          orderNumber: order.order_number,
          pump_name: pumpData.pump_name,
          neck_type: pumpData.neck_type,
          quantity: pumpData.quantity,
          team: pumpData.team || 'Pump',
          assigned_user: pumpData.assigned_user || (userInfo.role === 'team' ? userInfo.user : null),
          status: 'Pending',
          team_tracking: {
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
    
    order.item_ids.push(orderItem._id);
    await order.save({ session });
    
    await session.commitTransaction();
    session.endSession();

    const populatedOrderItem = await OrderItem.findById(orderItem._id)
      .populate('team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps');
    
    res.status(201).json({ 
      success: true, 
      message: 'Order item created successfully',
      data: populatedOrderItem 
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};