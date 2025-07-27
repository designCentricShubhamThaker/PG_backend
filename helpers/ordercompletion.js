import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import mongoose from 'mongoose';

export const checkItemCompletion = async (itemId, session = null) => {
  const options = session ? { session } : {};
  
  const result = await OrderItem.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(itemId) } },
    
    {
      $lookup: {
        from: 'glassitems',
        localField: 'team_assignments.glass',
        foreignField: '_id',
        as: 'glass_assignments'
      }
    },
    {
      $lookup: {
        from: 'capitems',
        localField: 'team_assignments.caps',
        foreignField: '_id',
        as: 'cap_assignments'
      }
    },
    {
      $lookup: {
        from: 'boxitems',
        localField: 'team_assignments.boxes',
        foreignField: '_id',
        as: 'box_assignments'
      }
    },
    {
      $lookup: {
        from: 'pumpitems',
        localField: 'team_assignments.pumps',
        foreignField: '_id',
        as: 'pump_assignments'
      }
    },
    {
      $lookup: {
        from: 'accessoriesitems',
        localField: 'team_assignments.accessories',
        foreignField: '_id',
        as: 'accessories_assignments'
      }
    },
    {
      $lookup: {
        from: 'coatingitems',
        localField: 'team_assignments.coating',
        foreignField: '_id',
        as: 'coating_assignments'
      }
    },
    {
      $lookup: {
        from: 'printingitems',
        localField: 'team_assignments.printing',
        foreignField: '_id',
        as: 'printing_assignments'
      }
    },
    {
      $lookup: {
        from: 'foilingitems',
        localField: 'team_assignments.foiling',
        foreignField: '_id',
        as: 'foiling_assignments'
      }
    },
    {
      $lookup: {
        from: 'frostingitems',
        localField: 'team_assignments.frosting',
        foreignField: '_id',
        as: 'frosting_assignments'
      }
    },
    
    {
      $addFields: {
        glassCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$glass_assignments' }, 0] },
            then: true, 
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$glass_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        // ✅ Updated caps completion logic to handle metal and assembly processes
        capsCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$cap_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$cap_assignments',
                  as: 'assignment',
                  in: {
                    $cond: {
                      if: { $regexMatch: { input: '$$assignment.process', regex: 'Assembly' } },
                      then: {
                        // For assembly caps, both metal and assembly must be completed
                        $and: [
                          {
                            $gte: [
                              { $ifNull: ['$$assignment.metal_tracking.total_completed_qty', 0] },
                              '$$assignment.quantity'
                            ]
                          },
                          {
                            $gte: [
                              { $ifNull: ['$$assignment.assembly_tracking.total_completed_qty', 0] },
                              '$$assignment.quantity'
                            ]
                          }
                        ]
                      },
                      else: {
                        // For non-assembly caps, only check metal tracking
                        $gte: [
                          { $ifNull: ['$$assignment.metal_tracking.total_completed_qty', 0] },
                          '$$assignment.quantity'
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        },
        boxesCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$box_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$box_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        pumpsCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$pump_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$pump_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        accessoriesCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$accessories_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$accessories_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        coatingCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$coating_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$coating_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        printingCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$printing_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$printing_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        foilingCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$foiling_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$foiling_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        },
        frostingCompleted: {
          $cond: {
            if: { $eq: [{ $size: '$frosting_assignments' }, 0] },
            then: true,
            else: {
              $allElementsTrue: {
                $map: {
                  input: '$frosting_assignments',
                  as: 'assignment',
                  in: {
                    $gte: [
                      { $ifNull: ['$$assignment.team_tracking.total_completed_qty', 0] },
                      '$$assignment.quantity'
                    ]
                  }
                }
              }
            }
          }
        }
      }
    },
    
    {
      $addFields: {
        itemFullyCompleted: {
          $and: [
            '$glassCompleted',
            '$capsCompleted',
            '$boxesCompleted',
            '$pumpsCompleted',
            '$accessoriesCompleted',
            '$coatingCompleted',
            '$printingCompleted',
            '$foilingCompleted',
            '$frostingCompleted'
          ]
        }
      }
    },
    
    { $project: { itemFullyCompleted: 1 } }
  ]).session(options.session);

  return result[0]?.itemFullyCompleted || false;
};

export const checkAndUpdateOrderCompletion = async (orderNumber, itemId, teamName, session = null) => {
  const options = session ? { session } : {};
  
  try {
    // First check if this specific item is fully completed
    const isItemCompleted = await checkItemCompletion(itemId, session);
    
    if (isItemCompleted) {
      // Update the item's team status for the specific team
      await OrderItem.findByIdAndUpdate(
        itemId,
        { $set: { [`team_status.${teamName.toLowerCase()}`]: 'Completed' } },
        options
      );
    }
  
    const order = await Order.findOne({ order_number: orderNumber }, null, options);
    if (!order) return false;
    
    let allItemsCompleted = true;
    
    for (const itemObjectId of order.item_ids) {
      const itemCompleted = await checkItemCompletion(itemObjectId.toString(), session);
      if (!itemCompleted) {
        allItemsCompleted = false;
        break;
      }
    }
    
    if (allItemsCompleted && order.order_status !== 'Completed') {
      await Order.findOneAndUpdate(
        { order_number: orderNumber },
        { $set: { order_status: 'Completed' } },
        options
      );
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('Error in checkAndUpdateOrderCompletion:', error);
    throw error;
  }
};

export const updateOrderCompletionStatus = async (orderNumber, itemId, teamName, session = null) => {
  return await checkAndUpdateOrderCompletion(orderNumber, itemId, teamName, session);
};