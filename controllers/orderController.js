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
    // Get the orderType from query parameters (pending, completed, or all)
    const { orderType } = req.query;

    // Create a filter object that will be used in the database query
    let filter = {};

    // Apply filtering based on orderType
    if (orderType === 'pending') {
      filter.order_status = 'Pending';
    } else if (orderType === 'completed') {
      filter.order_status = 'Completed';
    }
    // If orderType is not specified or is 'all', no filter is applied

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
          // ✅ FIXED: Properly populate decoration teams with glass_item_id
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
      data: orders
    });
  } catch (error) {
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
          pumps: [],
          accessories: [],
          coating: [],
          printing: [],
          foiling: [],
          frosting: []
        }
      });

      await orderItem.save({ session });
      itemIds.push(orderItem._id);

      // Glass
      if (item.glass?.length > 0) {
        for (const glassData of item.glass) {
          const glassItem = new GlassItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            glass_name: glassData.glass_name,
            quantity: glassData.quantity,
            rate: glassData.rate,
            weight: glassData.weight,
            neck_size: glassData.neck_size,
            decoration: glassData.decoration,
            decoration_no: glassData.decoration_no,
            decoration_details: glassData.decoration_details,
            team: glassData.team || 'Glass',
            status: 'Pending',
            team_tracking: {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });

          await glassItem.save({ session });

          const decorationKey = glassData.decoration || '';

          if (decorationKey.includes('coating')) {
            const coatingItem = await CoatingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: "Pending",
              team_tracking: {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.coating.push(coatingItem[0]._id);
          }

          if (decorationKey.includes('printing')) {
            const printingItem = await PrintingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: "Pending",
              team_tracking: {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.printing.push(printingItem[0]._id);
          }

          if (decorationKey.includes('foiling')) {
            const foilingItem = await FoilingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: "Pending",
              team_tracking: {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.foiling.push(foilingItem[0]._id);
          }

          if (decorationKey.includes('frosting')) {
            const frostingItem = await FrostingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: order_number,
              quantity: glassItem.quantity,
              status: "Pending",
              team_tracking: {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.frosting.push(frostingItem[0]._id);
          }

          orderItem.team_assignments.glass.push(glassItem._id);
        }
      }

      // Caps
      if (item.caps?.length > 0) {
        for (const capData of item.caps) {
          const capItem = new CapItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            cap_name: capData.cap_name,
            neck_size: capData.neck_size,
            quantity: capData.quantity,
            rate: capData.rate,
            process: capData.process,
            material: capData.material,
            team: capData.team || 'Caps',
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

      // Boxes
      if (item.boxes?.length > 0) {
        for (const boxData of item.boxes) {
          const boxItem = new BoxItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            box_name: boxData.box_name,
            quantity: boxData.quantity,
            rate: boxData.rate,
            approval_code: boxData.approval_code,
            team: boxData.team || 'Boxes',
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

      if (item.pumps?.length > 0) {
        for (const pumpData of item.pumps) {
          const pumpItem = new PumpItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            pump_name: pumpData.pump_name,
            neck_type: pumpData.neck_type,
            quantity: pumpData.quantity,
            rate: pumpData.rate,
            team: pumpData.team || 'Pumps',
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

      // Accessories
      if (item.accessories?.length > 0) {
        for (const accessoryData of item.accessories) {
          const accessoryItem = new AccessoriesItem({
            itemId: orderItem._id,
            orderNumber: order_number,
            accessories_name: accessoryData.accessories_name,
            rate: accessoryData.rate,
            quantity: accessoryData.quantity,
            accessory_type: accessoryData.accessory_type,
            material: accessoryData.material,
            team: accessoryData.team || 'Accessories',
            status: 'Pending',
            team_tracking: {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
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
        message: 'Duplicate key error. Order number must be unique.'
      });
    }

    next(error);
  }
};

export const createOrderItem = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { order_id } = req.params;
    const order = await Order.findById(order_id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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
        // ✅ FIXED: Include decoration teams
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

    // ✅ FIXED: Properly populate all team assignments including decoration teams
    const populatedItem = await OrderItem.findById(orderItem._id)
      .populate([
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

    res.status(201).json({ success: true, data: populatedItem });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
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
      items = []
    } = req.body;

    // Find the existing order with populated data
    const existingOrder = await Order.findById(req.params.id)
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

    if (!existingOrder) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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

    // IMPROVED: Build tracking map using properties as identifier
    const existingTrackingData = new Map();

    if (existingOrder.item_ids) {
      existingOrder.item_ids.forEach(item => {
        const itemKey = item.name;
        existingTrackingData.set(itemKey, {
          glass: new Map(),
          caps: new Map(),
          boxes: new Map(),
          pumps: new Map(),
          accessories: new Map(),
          decorationTracking: new Map() // Map glass properties to decoration tracking
        });

        const itemTracking = existingTrackingData.get(itemKey);

        // Store glass tracking data and create decoration mapping
        if (item.team_assignments?.glass) {
          item.team_assignments.glass.forEach(glassAssignment => {
            const glassKey = `${glassAssignment.glass_name}_${glassAssignment.neck_size}_${glassAssignment.decoration}`;

            itemTracking.glass.set(glassKey, {
              team_tracking: glassAssignment.team_tracking,
              status: glassAssignment.status,
              glassItemId: glassAssignment._id
            });

            // Initialize decoration tracking for this glass combination
            itemTracking.decorationTracking.set(glassKey, {
              coating: null,
              printing: null,
              foiling: null,
              frosting: null
            });
          });
        }

        // Map decoration team tracking to glass properties
        ['coating', 'printing', 'foiling', 'frosting'].forEach(decorationType => {
          if (item.team_assignments?.[decorationType]) {
            item.team_assignments[decorationType].forEach(decorationAssignment => {
              if (decorationAssignment.glass_item_id) {
                // Find the glass item that this decoration belongs to
                const relatedGlass = item.team_assignments.glass.find(g =>
                  g._id.toString() === decorationAssignment.glass_item_id._id.toString()
                );

                if (relatedGlass) {
                  const glassKey = `${relatedGlass.glass_name}_${relatedGlass.neck_size}_${relatedGlass.decoration}`;

                  if (itemTracking.decorationTracking.has(glassKey)) {
                    itemTracking.decorationTracking.get(glassKey)[decorationType] = {
                      team_tracking: decorationAssignment.team_tracking,
                      status: decorationAssignment.status
                    };
                  }
                }
              }
            });
          }
        });

        // Store CAP tracking data with special handling for dual tracking structure
        if (item.team_assignments?.caps) {
          item.team_assignments.caps.forEach(capAssignment => {
            const capKey = `${capAssignment.cap_name}_${capAssignment.neck_size}_${capAssignment.process}`;
            itemTracking.caps.set(capKey, {
              metal_tracking: capAssignment.metal_tracking,
              assembly_tracking: capAssignment.assembly_tracking,
              status: capAssignment.status
            });
          });
        }

        // Store other team tracking data (boxes, pumps, accessories)
        ['boxes', 'pumps', 'accessories'].forEach(teamType => {
          if (item.team_assignments?.[teamType]) {
            item.team_assignments[teamType].forEach(assignment => {
              const assignmentKey = getAssignmentKey(assignment, teamType);
              itemTracking[teamType].set(assignmentKey, {
                team_tracking: assignment.team_tracking,
                status: assignment.status
              });
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
          return `${assignment.cap_name}_${assignment.neck_size}_${assignment.process}`;
        case 'boxes':
          return `${assignment.box_name}_${assignment.approval_code}`;
        case 'pumps':
          return `${assignment.pump_name}_${assignment.neck_type}`;
        case 'accessories':
          return `${assignment.accessories_name}_${assignment.accessory_type}_${assignment.material}`;
        default:
          return assignment.name || 'default';
      }
    }

    // Helper functions for cap process validation
    const hasAssemblyProcess = (process) => {
      return process && process.includes('Assembly');
    };

    const hasMetalProcess = (process) => {
      return process && process.includes('Metal');
    };

    // Update order basic info
    existingOrder.order_number = order_number || existingOrder.order_number;
    existingOrder.dispatcher_name = dispatcher_name || existingOrder.dispatcher_name;
    existingOrder.customer_name = customer_name || existingOrder.customer_name;
    existingOrder.order_status = order_status || existingOrder.order_status;

    // Delete existing OrderItems and ALL associated items
    const existingOrderItems = await OrderItem.find({ order_number: oldOrderNumber });

    for (const item of existingOrderItems) {
      await GlassItem.deleteMany({ itemId: item._id }, { session });
      await CapItem.deleteMany({ itemId: item._id }, { session });
      await BoxItem.deleteMany({ itemId: item._id }, { session });
      await PumpItem.deleteMany({ itemId: item._id }, { session });
      await AccessoriesItem.deleteMany({ itemId: item._id }, { session });
      await CoatingItem.deleteMany({ itemId: item._id }, { session });
      await PrintingItem.deleteMany({ itemId: item._id }, { session });
      await FoilingItem.deleteMany({ itemId: item._id }, { session });
      await FrostingItem.deleteMany({ itemId: item._id }, { session });
      await item.deleteOne({ session });
    }

    // Clear the item_ids array
    existingOrder.item_ids = [];

    // Create new order items with preserved tracking data
    const itemIds = [];

    for (const item of items) {
      const orderItem = new OrderItem({
        order_number: existingOrder.order_number,
        name: item.name || `Item for ${existingOrder.order_number}`,
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
      itemIds.push(orderItem._id);

      const existingItemTracking = existingTrackingData.get(item.name) || {
        glass: new Map(),
        caps: new Map(),
        boxes: new Map(),
        pumps: new Map(),
        accessories: new Map(),
        decorationTracking: new Map()
      };

      // Handle Glass Items with preserved tracking
      if (item.glass && item.glass.length > 0) {
        for (const glassData of item.glass) {
          const glassKey = `${glassData.glass_name}_${glassData.neck_size}_${glassData.decoration}`;
          const existingGlassTracking = existingItemTracking.glass.get(glassKey);

          const glassItem = new GlassItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            glass_name: glassData.glass_name,
            quantity: glassData.quantity,
            weight: glassData.weight,
            rate: glassData.rate,
            neck_size: glassData.neck_size,
            decoration: glassData.decoration,
            decoration_no: glassData.decoration_no,
            decoration_details: glassData.decoration_details,
            team: glassData.team || 'Glass',
            status: existingGlassTracking?.status || glassData.status || 'Pending',
            team_tracking: existingGlassTracking?.team_tracking || glassData.team_tracking || {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });

          await glassItem.save({ session });
          orderItem.team_assignments.glass.push(glassItem._id);

          // Handle decoration items with preserved tracking
          const decorationKey = glassData.decoration || '';
          const existingDecorationTracking = existingItemTracking.decorationTracking.get(glassKey);

          if (decorationKey.includes('coating')) {
            const existingCoatingTracking = existingDecorationTracking?.coating;
            const coatingItem = await CoatingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: existingOrder.order_number,
              quantity: glassItem.quantity,
              status: existingCoatingTracking?.status || "Pending",
              team_tracking: existingCoatingTracking?.team_tracking || {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.coating.push(coatingItem[0]._id);
          }

          if (decorationKey.includes('printing')) {
            const existingPrintingTracking = existingDecorationTracking?.printing;
            const printingItem = await PrintingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: existingOrder.order_number,
              quantity: glassItem.quantity,
              status: existingPrintingTracking?.status || "Pending",
              team_tracking: existingPrintingTracking?.team_tracking || {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.printing.push(printingItem[0]._id);
          }

          if (decorationKey.includes('foiling')) {
            const existingFoilingTracking = existingDecorationTracking?.foiling;
            const foilingItem = await FoilingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: existingOrder.order_number,
              quantity: glassItem.quantity,
              status: existingFoilingTracking?.status || "Pending",
              team_tracking: existingFoilingTracking?.team_tracking || {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.foiling.push(foilingItem[0]._id);
          }

          if (decorationKey.includes('frosting')) {
            const existingFrostingTracking = existingDecorationTracking?.frosting;
            const frostingItem = await FrostingItem.create([{
              glass_item_id: glassItem._id,
              itemId: orderItem._id,
              orderNumber: existingOrder.order_number,
              quantity: glassItem.quantity,
              status: existingFrostingTracking?.status || "Pending",
              team_tracking: existingFrostingTracking?.team_tracking || {
                total_completed_qty: 0,
                completed_entries: [],
                status: "Pending"
              }
            }], { session });
            orderItem.team_assignments.frosting.push(frostingItem[0]._id);
          }
        }
      }

      // Handle Cap Items with preserved DUAL tracking (metal_tracking + assembly_tracking)
      if (item.caps && item.caps.length > 0) {
        for (const capData of item.caps) {
          const capKey = `${capData.cap_name}_${capData.neck_size}_${capData.process}`;
          const existingCapTracking = existingItemTracking.caps.get(capKey);

          // Initialize default tracking structures
          const defaultMetalTracking = {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          };

          const defaultAssemblyTracking = {
            total_completed_qty: 0,
            completed_entries: [],
            status: 'Pending'
          };

          // Determine which tracking fields should exist based on process
          const hasMetal = hasMetalProcess(capData.process);
          const hasAssembly = hasAssemblyProcess(capData.process);

          const capItem = new CapItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            cap_name: capData.cap_name,
            neck_size: capData.neck_size,
            quantity: capData.quantity,
            rate: capData.rate,
            process: capData.process,
            material: capData.material,
            team: capData.team || 'Caps',
            status: existingCapTracking?.status || capData.status || 'Pending',
            // Preserve existing tracking data or use defaults
            metal_tracking: hasMetal ? (existingCapTracking?.metal_tracking || capData.metal_tracking || defaultMetalTracking) : undefined,
            assembly_tracking: hasAssembly ? (existingCapTracking?.assembly_tracking || capData.assembly_tracking || defaultAssemblyTracking) : undefined
          });

          await capItem.save({ session });
          orderItem.team_assignments.caps.push(capItem._id);
        }
      }

      // Handle other team items (boxes, pumps, accessories) with standard team_tracking
      if (item.boxes && item.boxes.length > 0) {
        for (const boxData of item.boxes) {
          const assignmentKey = getAssignmentKey(boxData, 'boxes');
          const existingTracking = existingItemTracking.boxes.get(assignmentKey);

          const boxItem = new BoxItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            box_name: boxData.box_name,
            quantity: boxData.quantity,
            rate: boxData.rate,
            approval_code: boxData.approval_code,
            team: boxData.team || 'Boxes',
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

      if (item.pumps && item.pumps.length > 0) {
        for (const pumpData of item.pumps) {
          const assignmentKey = getAssignmentKey(pumpData, 'pumps');
          const existingTracking = existingItemTracking.pumps.get(assignmentKey);

          const pumpItem = new PumpItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            pump_name: pumpData.pump_name,
            neck_type: pumpData.neck_type,
            quantity: pumpData.quantity,
            rate: pumpData.rate,
            team: pumpData.team || 'Pumps',
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

      if (item.accessories && item.accessories.length > 0) {
        for (const accessoryData of item.accessories) {
          const assignmentKey = getAssignmentKey(accessoryData, 'accessories');
          const existingTracking = existingItemTracking.accessories.get(assignmentKey);

          const accessoryItem = new AccessoriesItem({
            itemId: orderItem._id,
            orderNumber: existingOrder.order_number,
            accessories_name: accessoryData.accessories_name,
            quantity: accessoryData.quantity,
            rate: accessoryData.rate,
            accessory_type: accessoryData.accessory_type,
            material: accessoryData.material,
            team: accessoryData.team || 'Accessories',
            status: existingTracking?.status || accessoryData.status || 'Pending',
            team_tracking: existingTracking?.team_tracking || accessoryData.team_tracking || {
              total_completed_qty: 0,
              completed_entries: [],
              status: 'Pending'
            }
          });

          await accessoryItem.save({ session });
          orderItem.team_assignments.accessories.push(accessoryItem._id);
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


export const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps team_assignments.accessories',
        },
      });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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
    const { orderNumber } = req.params;

    const order = await Order.findOne({ order_number: orderNumber })
      .populate({
        path: 'item_ids',
        populate: {
          path: 'team_assignments.glass team_assignments.caps team_assignments.boxes team_assignments.pumps team_assignments.accessories',
        },
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found with this number'
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
        pumps: item.team_assignments.pumps || [],
        accessories: item.team_assignments.accessories || []
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


export const deleteOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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
    }

    // ✅ Delete all associated OrderItems
    await OrderItem.deleteMany({ order_number: order.order_number }, { session });

    // ✅ Delete the main Order
    await order.deleteOne({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ success: true, message: 'Order and all associated data deleted successfully' });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};
