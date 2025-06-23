import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import GlassItem from '../models/GlassItem.js';
import DecorationItem from '../models/DecorationItem.js';
import mongoose from 'mongoose';

const DECORATION_COMBINATIONS = {
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

export const getDecorationOrders = async (req, res, next) => {
  try {
    const { decorationType, orderType } = req.query;

    // Validate decoration type
    if (decorationType && !DECORATION_COMBINATIONS[decorationType]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decoration type. Valid types: ' + Object.keys(DECORATION_COMBINATIONS).join(', ')
      });
    }

    let decorationFilter = {};
    if (orderType === 'pending') {
      decorationFilter.status = 'Pending';
    }
    else if (orderType === 'completed') {
      decorationFilter.status = 'Completed';
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: decorationFilter },
      {
        $lookup: {
          from: 'glassitems',
          localField: 'glassItemId',
          foreignField: '_id',
          as: 'glassItem'
        }
      },
      {
        $lookup: {
          from: 'orderitems',
          localField: 'itemId',
          foreignField: '_id',
          as: 'orderItem'
        }
      },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderNumber',
          foreignField: 'order_number',
          as: 'order'
        }
      },
      {
        $unwind: '$glassItem'
      },
      {
        $unwind: '$orderItem'
      },
      {
        $unwind: '$order'
      }
    ];

    // Add decoration type filter if specified
    if (decorationType) {
      const requiredDecorations = DECORATION_COMBINATIONS[decorationType];
      pipeline.push({
        $match: {
          decoration_type: { $in: requiredDecorations }
        }
      });
    }

    // Group by order and item for better organization
    pipeline.push({
      $group: {
        _id: {
          orderNumber: '$orderNumber',
          itemId: '$itemId'
        },
        order: { $first: '$order' },
        orderItem: { $first: '$orderItem' },
        glassItem: { $first: '$glassItem' },
        decorations: {
          $push: {
            _id: '$_id',
            decoration_type: '$decoration_type',
            decoration_number: '$decoration_number',
            decoration_details: '$decoration_details',
            team: '$team',
            status: '$status',
            team_tracking: '$team_tracking',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt'
          }
        }
      }
    });

    pipeline.push({
      $project: {
        _id: 0,
        orderNumber: '$_id.orderNumber',
        itemId: '$_id.itemId',
        order: '$order',
        orderItem: '$orderItem',
        glassItem: '$glassItem',
        decorations: '$decorations',
        totalDecorations: { $size: '$decorations' },
        completedDecorations: {
          $size: {
            $filter: {
              input: '$decorations',
              cond: { $eq: ['$$this.status', 'Completed'] }
            }
          }
        }
      }
    });

    const decorationOrders = await DecorationItem.aggregate(pipeline);

    res.status(200).json({
      success: true,
      count: decorationOrders.length,
      data: decorationOrders
    });

  } catch (error) {
    next(error);
  }
};


export const sendToDecorationTeam = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const {
      orderNumber,
      itemId,
      glassItemId,
      decorationCombination,
      decorationDetails,
      team = 'decoration'
    } = req.body;

    // Validate required fields
    if (!orderNumber || !itemId || !glassItemId || !decorationCombination) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: orderNumber, itemId, glassItemId, decorationCombination'
      });
    }

    // Validate decoration combination
    if (!DECORATION_COMBINATIONS[decorationCombination]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decoration combination. Valid combinations: ' + Object.keys(DECORATION_COMBINATIONS).join(', ')
      });
    }

    await session.withTransaction(async () => {
      // Verify the glass item exists and get its details
      const glassItem = await GlassItem.findById(glassItemId).session(session);
      if (!glassItem) {
        throw new Error('Glass item not found');
      }

      // Verify the order item exists
      const orderItem = await OrderItem.findById(itemId).session(session);
      if (!orderItem) {
        throw new Error('Order item not found');
      }

      // Verify the order exists
      const order = await Order.findOne({ order_number: orderNumber }).session(session);
      if (!order) {
        throw new Error('Order not found');
      }

      // Get the decoration types for this combination
      const decorationTypes = DECORATION_COMBINATIONS[decorationCombination];

      // Create decoration items for each type in the combination
      const decorationItems = [];

      for (let i = 0; i < decorationTypes.length; i++) {
        const decorationType = decorationTypes[i];

        // Check if decoration item already exists
        const existingDecoration = await DecorationItem.findOne({
          glassItemId,
          orderNumber,
          itemId,
          decoration_type: decorationType
        }).session(session);

        if (existingDecoration) {
          decorationItems.push(existingDecoration);
          continue;
        }

        // Create new decoration item
        const decorationItem = new DecorationItem({
          glassItemId,
          orderNumber,
          itemId,
          decoration_type: decorationType,
          decoration_number: `${orderNumber}-${itemId}-${decorationType.toUpperCase()}-${Date.now()}`,
          decoration_details: decorationDetails?.[decorationType] || `${decorationType} decoration for ${glassItem.glass_name}`,
          team,
          status: 'Pending',
          team_tracking: {
            total_completed_qty: 0,
            completed_entries: [],
            last_updated: new Date()
          }
        });

        const savedDecoration = await decorationItem.save({ session });
        decorationItems.push(savedDecoration);
      }

      // Update the glass item status to indicate it's been sent to decoration
      await GlassItem.findByIdAndUpdate(
        glassItemId,
        {
          $set: {
            decoration_status: 'Sent to Decoration',
            last_updated: new Date()
          }
        },
        { session }
      );
    });

    // Fetch the created decoration items with populated data
    const createdDecorations = await DecorationItem.find({
      glassItemId,
      orderNumber,
      itemId
    })
      .populate('glassItemId')
      .populate('itemId')
      .lean();

    res.status(201).json({
      success: true,
      message: `Successfully sent glass item to decoration team with ${decorationCombination} combination`,
      data: {
        orderNumber,
        itemId,
        glassItemId,
        decorationCombination,
        decorationTypes: DECORATION_COMBINATIONS[decorationCombination],
        decorationItems: createdDecorations
      }
    });

  } catch (error) {
    console.error('Error sending to decoration team:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  } finally {
    await session.endSession();
  }
};


export const updateDecorationTracking = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const {
      decorationId,
      newEntry,
      newTotalCompleted,
      newStatus
    } = req.body;

    if (!decorationId || !newEntry || newTotalCompleted === undefined || !newStatus) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: decorationId, newEntry, newTotalCompleted, newStatus'
      });
    }

    await session.withTransaction(async () => {
      const decorationItem = await DecorationItem.findById(decorationId).session(session);

      if (!decorationItem) {
        throw new Error('Decoration item not found');
      }

      // Update the decoration item
      await DecorationItem.findByIdAndUpdate(
        decorationId,
        {
          $set: {
            'team_tracking.total_completed_qty': newTotalCompleted,
            'team_tracking.last_updated': new Date(),
            status: newStatus
          },
          $push: {
            'team_tracking.completed_entries': {
              ...newEntry,
              date: new Date(newEntry.date)
            }
          }
        },
        { session, new: true }
      );

      // Check if all decorations for this glass item are completed
      const allDecorations = await DecorationItem.find({
        glassItemId: decorationItem.glassItemId,
        orderNumber: decorationItem.orderNumber,
        itemId: decorationItem.itemId
      }).session(session);

      const allCompleted = allDecorations.every(decoration => decoration.status === 'Completed');

      if (allCompleted) {
        // Update glass item decoration status
        await GlassItem.findByIdAndUpdate(
          decorationItem.glassItemId,
          {
            $set: {
              decoration_status: 'Decoration Completed',
              last_updated: new Date()
            }
          },
          { session }
        );
      }
    });

    const updatedDecoration = await DecorationItem.findById(decorationId)
      .populate('glassItemId')
      .populate('itemId')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Decoration tracking updated successfully',
      data: updatedDecoration
    });

  } catch (error) {
    console.error('Error updating decoration tracking:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  } finally {
    await session.endSession();
  }
};


export const getDecorationCombinations = async (req, res, next) => {
  try {
    const combinations = Object.keys(DECORATION_COMBINATIONS).map(key => ({
      key,
      name: key.replace(/_/g, ' + ').toUpperCase(),
      types: DECORATION_COMBINATIONS[key]
    }));

    res.status(200).json({
      success: true,
      data: combinations
    });
  } catch (error) {
    next(error);
  }
};