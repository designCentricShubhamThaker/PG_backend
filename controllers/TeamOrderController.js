import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import GlassItem from '../models/GlassItem.js';
import CapItem from '../models/CapItem.js';
import BoxItem from '../models/BoxItem.js';
import PumpItem from '../models/PumpItem.js';
import AccessoriesItem from '../models/AccessoriesItem.js';
import mongoose from 'mongoose';
import CoatingItem from '../models/CoatingItem.js';
import PrintingItem from '../models/PrintingItem.js';
import FrostingItem from '../models/FrostingItem.js';
import FoilingItem from '../models/FoilingItem.js';



export const getAllOrders = async (req, res, next) => {
  try {
    const { team, created_by, orderType } = req.query;

    // Validate required fields
    if (!team || !created_by) {
      return res.status(400).json({
        success: false,
        message: 'Team and created_by are required',
      });
    }

    // Build filter
    const filter = {
      team,
      created_by
    };

    // Apply orderType filtering
    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate({
        path: 'item_ids',
        populate: [
          { path: 'team_assignments.glass' },
          { path: 'team_assignments.caps' },
          { path: 'team_assignments.boxes' },
          { path: 'team_assignments.pumps' },
          { path: 'team_assignments.accessories' },
          {
            path: 'team_assignments.coating',
            populate: { path: 'glass_item_id' }
          },
          {
            path: 'team_assignments.printing',
            populate: { path: 'glass_item_id' }
          },
          {
            path: 'team_assignments.foiling',
            populate: { path: 'glass_item_id' }
          },
          {
            path: 'team_assignments.frosting',
            populate: { path: 'glass_item_id' }
          }
        ]
      });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error('Error fetching filtered orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
    });
  }
};


export const getOrderById = async (req, res, next) => {
  try {
    const { team, user } = req.query;

    let filter = { _id: req.params.id };
    if (team) filter.team = team;
    if (user) filter.created_by = user;

    console.log('getOrderById Filter:', filter);

    const order = await Order.findOne(filter)
      .populate({
        path: 'item_ids',
        populate: [
          { path: 'team_assignments.glass' },
          { path: 'team_assignments.caps' },
          { path: 'team_assignments.boxes' },
          { path: 'team_assignments.pumps' },
          { path: 'team_assignments.accessories' },
          { path: 'team_assignments.coating', populate: { path: 'glass_item_id' } },
          { path: 'team_assignments.printing', populate: { path: 'glass_item_id' } },
          { path: 'team_assignments.foiling', populate: { path: 'glass_item_id' } },
          { path: 'team_assignments.frosting', populate: { path: 'glass_item_id' } }
        ]
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

    let filter = { order_number: orderNumber };
    if (team) filter.team = team;
    if (user) filter.created_by = user;

    console.log('getOrderByNumber Filter:', filter);

    const order = await Order.findOne(filter)
      .populate({
        path: 'item_ids',
        populate: [
          { path: 'team_assignments.glass' },
          { path: 'team_assignments.caps' },
          { path: 'team_assignments.boxes' },
          { path: 'team_assignments.pumps' },
          { path: 'team_assignments.accessories' },
          { path: 'team_assignments.coating', populate: { path: 'glass_item_id' } },
          { path: 'team_assignments.printing', populate: { path: 'glass_item_id' } },
          { path: 'team_assignments.foiling', populate: { path: 'glass_item_id' } },
          { path: 'team_assignments.frosting', populate: { path: 'glass_item_id' } }
        ]
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found with this number or you do not have permission to view this order'
      });
    }

    const transformedOrder = {
      ...order.toObject(),
      items: order.item_ids.map(item => ({
        name: item.name,
        glass: item.team_assignments.glass || [],
        caps: item.team_assignments.caps || [],
        boxes: item.team_assignments.boxes || [],
        pumps: item.team_assignments.pumps || [],
        accessories: item.team_assignments.accessories || [],
        coating: item.team_assignments.coating || [],
        printing: item.team_assignments.printing || [],
        foiling: item.team_assignments.foiling || [],
        frosting: item.team_assignments.frosting || []
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
  let transactionCommitted = false;

  try {
    const {
      order_number,
      dispatcher_name,
      customer_name,
      team,
      created_by,
      order_status = 'Pending',
      items = []
    } = req.body;

    if (!order_number || !dispatcher_name || !customer_name || !team || !created_by) {
      return res.status(400).json({
        success: false,
        message: 'order_number, dispatcher_name, customer_name, team, and created_by are required'
      });
    }

    const orderExists = await Order.findOne({ order_number, team });
    if (orderExists) {
      return res.status(400).json({
        success: false,
        message: `Order number ${order_number} already exists for team ${team}`
      });
    }

    const newOrder = new Order({
      order_number,
      dispatcher_name,
      customer_name,
      team,
      created_by,
      order_status,
      item_ids: []
    });

    await newOrder.save({ session });

    const itemIds = [];

    for (const item of items) {
      const orderItem = new OrderItem({
        order_number,
        name: item.name || `Item for ${order_number}`,
        team_assignments: {
          glass: [], caps: [], boxes: [], pumps: [],
          accessories: [], coating: [], printing: [], foiling: [], frosting: []
        }
      });

      await orderItem.save({ session });
      itemIds.push(orderItem._id);

      // GLASS
      if (item.glass?.length > 0) {
        for (const g of item.glass) {
          const glassItem = new GlassItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            glass_name: g.glass_name,
            quantity: g.quantity,
            rate: g.rate,
            weight: g.weight,
            neck_size: g.neck_size,
            decoration: g.decoration,
            decoration_no: g.decoration_no,
            decoration_details: g.decoration_details,
            team: g.team || 'Glass',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
          });

          await glassItem.save({ session });
          orderItem.team_assignments.glass.push(glassItem._id);

          const deco = g.decoration || '';

          if (deco.includes('coating')) {
            const [coatingItem] = await CoatingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: 'Pending',
              team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
            }], { session });
            orderItem.team_assignments.coating.push(coatingItem._id);
          }

          if (deco.includes('printing')) {
            const [printingItem] = await PrintingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: 'Pending',
              team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
            }], { session });
            orderItem.team_assignments.printing.push(printingItem._id);
          }

          if (deco.includes('foiling')) {
            const [foilingItem] = await FoilingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: 'Pending',
              team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
            }], { session });
            orderItem.team_assignments.foiling.push(foilingItem._id);
          }

          if (deco.includes('frosting')) {
            const [frostingItem] = await FrostingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: 'Pending',
              team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
            }], { session });
            orderItem.team_assignments.frosting.push(frostingItem._id);
          }
        }
      }

      // CAPS
      if (item.caps?.length > 0) {
        for (const c of item.caps) {
          const capItem = new CapItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            cap_name: c.cap_name,
            neck_size: c.neck_size,
            quantity: c.quantity,
            rate: c.rate,
            process: c.process,
            material: c.material,
            team: c.team || 'Caps',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
          });
          await capItem.save({ session });
          orderItem.team_assignments.caps.push(capItem._id);
        }
      }

      // BOXES
      if (item.boxes?.length > 0) {
        for (const b of item.boxes) {
          const boxItem = new BoxItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            box_name: b.box_name,
            quantity: b.quantity,
            rate: b.rate,
            approval_code: b.approval_code,
            team: b.team || 'Boxes',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
          });
          await boxItem.save({ session });
          orderItem.team_assignments.boxes.push(boxItem._id);
        }
      }

      // PUMPS
      if (item.pumps?.length > 0) {
        for (const p of item.pumps) {
          const pumpItem = new PumpItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            pump_name: p.pump_name,
            neck_type: p.neck_type,
            quantity: p.quantity,
            rate: p.rate,
            team: p.team || 'Pumps',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
          });
          await pumpItem.save({ session });
          orderItem.team_assignments.pumps.push(pumpItem._id);
        }
      }

      // ACCESSORIES
      if (item.accessories?.length > 0) {
        for (const a of item.accessories) {
          const accessoryItem = new AccessoriesItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            accessories_name: a.accessories_name,
            rate: a.rate,
            quantity: a.quantity,
            accessory_type: a.accessory_type,
            material: a.material,
            team: a.team || 'Accessories',
            status: 'Pending',
            team_tracking: { total_completed_qty: 0, completed_entries: [], status: 'Pending' }
          });
          await accessoryItem.save({ session });
          orderItem.team_assignments.accessories.push(accessoryItem._id);
        }
      }

      await orderItem.save({ session });
    }

    newOrder.item_ids = itemIds;
    await newOrder.save({ session });

    await session.commitTransaction();
    transactionCommitted = true;
    session.endSession();

    const populatedOrder = await Order.findById(newOrder._id).populate({
      path: 'item_ids',
      populate: [
        { path: 'team_assignments.glass' },
        { path: 'team_assignments.caps' },
        { path: 'team_assignments.boxes' },
        { path: 'team_assignments.pumps' },
        { path: 'team_assignments.accessories' },
        { path: 'team_assignments.coating', populate: { path: 'glass_item_id' } },
        { path: 'team_assignments.printing', populate: { path: 'glass_item_id' } },
        { path: 'team_assignments.foiling', populate: { path: 'glass_item_id' } },
        { path: 'team_assignments.frosting', populate: { path: 'glass_item_id' } }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: populatedOrder
    });

  } catch (error) {
    if (!transactionCommitted) {
      await session.abortTransaction();
    }
    session.endSession();

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate key error. Order number must be unique within the team.'
      });
    }

    console.error('Error creating order:', error);
    next(error);
  }
};


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

    let filter = { _id: req.params.id };
    if (req.query.team) filter.team = req.query.team;
    if (req.query.user) filter.created_by = req.query.user;

    const existingOrder = await Order.findOne(filter).populate({
      path: 'item_ids',
      populate: {
        path: [
          'team_assignments.glass',
          'team_assignments.caps',
          'team_assignments.boxes',
          'team_assignments.pumps',
          'team_assignments.accessories'
        ]
      }
    });

    if (!existingOrder) {
      return res.status(404).json({ success: false, message: 'Order not found or unauthorized' });
    }

    const oldOrderNumber = existingOrder.order_number;

    if (order_number && order_number !== oldOrderNumber) {
      const orderExists = await Order.findOne({
        order_number,
        team: existingOrder.team,
        _id: { $ne: req.params.id }
      });
      if (orderExists) {
        return res.status(400).json({
          success: false,
          message: `Order number ${order_number} already exists in team ${existingOrder.team}`
        });
      }
    }

    // Preserve existing tracking
    const existingTrackingData = new Map();
    if (existingOrder.item_ids) {
      existingOrder.item_ids.forEach(item => {
        const itemKey = item.name;
        existingTrackingData.set(itemKey, {
          glass: {}, caps: {}, boxes: {}, pumps: {}, accessories: {}
        });

        ['glass', 'caps', 'boxes', 'pumps', 'accessories'].forEach(type => {
          item.team_assignments?.[type]?.forEach(assignment => {
            const key = getAssignmentKey(assignment, type);
            existingTrackingData.get(itemKey)[type][key] = {
              team_tracking: assignment.team_tracking,
              status: assignment.status
            };
          });
        });
      });
    }

    function getAssignmentKey(a, type) {
      switch (type) {
        case 'glass': return `${a.glass_name}_${a.neck_size}_${a.decoration}`;
        case 'caps': return `${a.cap_name}_${a.neck_size}_${a.material}`;
        case 'boxes': return `${a.box_name}_${a.approval_code}`;
        case 'pumps': return `${a.pump_name}_${a.neck_type}`;
        case 'accessories': return `${a.accessories_name}_${a.accessory_type}_${a.material}`;
        default: return a.name || 'default';
      }
    }

    // Update base order fields
    existingOrder.order_number = order_number || existingOrder.order_number;
    existingOrder.dispatcher_name = dispatcher_name || existingOrder.dispatcher_name;
    existingOrder.customer_name = customer_name || existingOrder.customer_name;
    existingOrder.order_status = order_status || existingOrder.order_status;
    existingOrder.team = team || existingOrder.team;
    existingOrder.created_by = created_by || existingOrder.created_by;

    const existingOrderItems = await OrderItem.find({ order_number: oldOrderNumber });

    for (const item of existingOrderItems) {
      await Promise.all([
        GlassItem.deleteMany({ itemId: item._id }, { session }),
        CapItem.deleteMany({ itemId: item._id }, { session }),
        BoxItem.deleteMany({ itemId: item._id }, { session }),
        PumpItem.deleteMany({ itemId: item._id }, { session }),
        AccessoriesItem.deleteMany({ itemId: item._id }, { session }),
        item.deleteOne({ session })
      ]);
    }

    existingOrder.item_ids = [];

    const itemIds = [];

    for (const item of items) {
      const orderItem = new OrderItem({
        order_number: existingOrder.order_number,
        name: item.name || `Item for ${existingOrder.order_number}`,
        team_assignments: {
          glass: [], caps: [], boxes: [], pumps: [], accessories: []
        }
      });

      await orderItem.save({ session });
      itemIds.push(orderItem._id);

      const trackingMap = existingTrackingData.get(item.name) || {
        glass: {}, caps: {}, boxes: {}, pumps: {}, accessories: {}
      };

      // === GLASS
      for (const g of item.glass || []) {
        const key = getAssignmentKey(g, 'glass');
        const t = trackingMap.glass[key];

        const glassItem = new GlassItem({
          itemId: orderItem._id,
          orderNumber: existingOrder.order_number,
          glass_name: g.glass_name,
          quantity: g.quantity,
          weight: g.weight,
          rate: g.rate,
          neck_size: g.neck_size,
          decoration: g.decoration,
          decoration_no: g.decoration_no,
          decoration_details: g.decoration_details,
          team: g.team || 'Glass',
          status: t?.status || g.status || 'Pending',
          team_tracking: t?.team_tracking || g.team_tracking || {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        await glassItem.save({ session });
        orderItem.team_assignments.glass.push(glassItem._id);
      }

      // === CAPS
      for (const c of item.caps || []) {
        const key = getAssignmentKey(c, 'caps');
        const t = trackingMap.caps[key];

        const capItem = new CapItem({
          itemId: orderItem._id,
          orderNumber: existingOrder.order_number,
          cap_name: c.cap_name,
          neck_size: c.neck_size,
          quantity: c.quantity,
          rate: c.rate,
          process: c.process,
          material: c.material,
          team: c.team || 'Caps',
          status: t?.status || c.status || 'Pending',
          team_tracking: t?.team_tracking || c.team_tracking || {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        await capItem.save({ session });
        orderItem.team_assignments.caps.push(capItem._id);
      }

      // === BOXES
      for (const b of item.boxes || []) {
        const key = getAssignmentKey(b, 'boxes');
        const t = trackingMap.boxes[key];

        const boxItem = new BoxItem({
          itemId: orderItem._id,
          orderNumber: existingOrder.order_number,
          box_name: b.box_name,
          quantity: b.quantity,
          rate: b.rate,
          approval_code: b.approval_code,
          team: b.team || 'Boxes',
          status: t?.status || b.status || 'Pending',
          team_tracking: t?.team_tracking || b.team_tracking || {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        await boxItem.save({ session });
        orderItem.team_assignments.boxes.push(boxItem._id);
      }

      // === PUMPS
      for (const p of item.pumps || []) {
        const key = getAssignmentKey(p, 'pumps');
        const t = trackingMap.pumps[key];

        const pumpItem = new PumpItem({
          itemId: orderItem._id,
          orderNumber: existingOrder.order_number,
          pump_name: p.pump_name,
          neck_type: p.neck_type,
          quantity: p.quantity,
          rate: p.rate,
          team: p.team || 'Pumps',
          status: t?.status || p.status || 'Pending',
          team_tracking: t?.team_tracking || p.team_tracking || {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        await pumpItem.save({ session });
        orderItem.team_assignments.pumps.push(pumpItem._id);
      }

      // === ACCESSORIES
      for (const a of item.accessories || []) {
        const key = getAssignmentKey(a, 'accessories');
        const t = trackingMap.accessories[key];

        const accessoryItem = new AccessoriesItem({
          itemId: orderItem._id,
          orderNumber: existingOrder.order_number,
          accessories_name: a.accessories_name,
          quantity: a.quantity,
          rate: a.rate,
          accessory_type: a.accessory_type,
          material: a.material,
          team: a.team || 'Accessories',
          status: t?.status || a.status || 'Pending',
          team_tracking: t?.team_tracking || a.team_tracking || {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          }
        });
        await accessoryItem.save({ session });
        orderItem.team_assignments.accessories.push(accessoryItem._id);
      }

      await orderItem.save({ session });
    }

    existingOrder.item_ids = itemIds;
    await existingOrder.save({ session });

    await session.commitTransaction();
    session.endSession();

    const updatedOrder = await Order.findById(existingOrder._id).populate({
      path: 'item_ids',
      populate: {
        path: [
          'team_assignments.glass',
          'team_assignments.caps',
          'team_assignments.boxes',
          'team_assignments.pumps',
          'team_assignments.accessories'
        ]
      }
    });

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
      data: updatedOrder
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Update order error:', error);
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

    // Permission-based filter
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
      await AccessoriesItem.deleteMany({ itemId: item._id }, { session });
      await PrintingItem.deleteMany({ itemId: item._id }, { session });
      await CoatingItem.deleteMany({ itemId: item._id }, { session });
      await FoilingItem.deleteMany({ itemId: item._id }, { session });
      await FrostingItem.deleteMany({ itemId: item._id }, { session });

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

    // Optional permission filtering
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
        pumps: [],
        accessories: [],
        coating: [],
        printing: [],
        foiling: [],
        frosting: []
      }
    });

    await orderItem.save({ session });

    order.item_ids.push(orderItem._id);
    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Populate all possible team assignments including decoration
    const populatedItem = await OrderItem.findById(orderItem._id).populate([
      { path: 'team_assignments.glass' },
      { path: 'team_assignments.caps' },
      { path: 'team_assignments.boxes' },
      { path: 'team_assignments.pumps' },
      { path: 'team_assignments.accessories' },
      {
        path: 'team_assignments.coating',
        populate: { path: 'glass_item_id' }
      },
      {
        path: 'team_assignments.printing',
        populate: { path: 'glass_item_id' }
      },
      {
        path: 'team_assignments.foiling',
        populate: { path: 'glass_item_id' }
      },
      {
        path: 'team_assignments.frosting',
        populate: { path: 'glass_item_id' }
      }
    ]);

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
