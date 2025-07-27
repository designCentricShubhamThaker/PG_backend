// scripts/cleanup-database.js
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';

// MongoDB connection - adjust to match your config
const MONGODB_URI = 'mongodb+srv://thakers968:Vf7PIFKvyCYnhzQd@cluster0.udg2g.mongodb.net/pragati-glass?retryWrites=true&w=majority&appName=Cluster0'; // Update this

const cleanupCorruptedData = async () => {
  try {
    console.log('🧹 Starting database cleanup...');
    
    // Find all orders
    const orders = await Order.find({}).lean();
    let fixedCount = 0;
    let totalCorruptedFound = 0;
    
    console.log(`📊 Found ${orders.length} orders to check`);
    
    for (const order of orders) {
      console.log(`🔍 Checking order: ${order.order_number}`);
      let orderNeedsUpdate = false;
      
      for (const itemId of order.item_ids) {
        const item = await OrderItem.findById(itemId);
        if (!item) {
          console.log(`⚠️ Item not found: ${itemId}`);
          continue;
        }
        
        let itemNeedsUpdate = false;
        const cleanedAssignments = {};
        
        // Clean each team assignment array
        const teamTypes = ['glass', 'caps', 'boxes', 'pumps', 'accessories', 'coating', 'printing', 'foiling', 'frosting'];
        
        for (const teamType of teamTypes) {
          if (item.team_assignments?.[teamType] && Array.isArray(item.team_assignments[teamType])) {
            const originalArray = item.team_assignments[teamType];
            let corruptedInThisArray = 0;
            
            // Filter out corrupted objects
            const cleanArray = originalArray.filter(element => {
              if (!element || typeof element !== 'object') {
                console.log(`🗑️ Removing non-object from ${teamType}:`, element);
                corruptedInThisArray++;
                return false;
              }
              
              // Check if this is a corrupted array-like object
              const keys = Object.keys(element);
              const isCorrupted = keys.length > 0 && keys.every(key => /^\d+$/.test(key));
              
              if (isCorrupted) {
                console.log(`🗑️ Removing corrupted ${teamType} data (order ${order.order_number}):`, 
                  `Object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
                corruptedInThisArray++;
                return false;
              }
              
              return true;
            });
            
            if (corruptedInThisArray > 0) {
              cleanedAssignments[`team_assignments.${teamType}`] = cleanArray;
              itemNeedsUpdate = true;
              totalCorruptedFound += corruptedInThisArray;
              console.log(`✅ Will clean ${teamType} array: ${originalArray.length} → ${cleanArray.length} (removed ${corruptedInThisArray} corrupted)`);
            }
          }
        }
        
        if (itemNeedsUpdate) {
          try {
            await OrderItem.findByIdAndUpdate(itemId, { $set: cleanedAssignments });
            fixedCount++;
            orderNeedsUpdate = true;
            console.log(`✅ Updated item ${itemId} in order ${order.order_number}`);
          } catch (updateError) {
            console.error(`❌ Failed to update item ${itemId}:`, updateError.message);
          }
        }
      }
      
      if (orderNeedsUpdate) {
        console.log(`✅ Fixed order: ${order.order_number}`);
      }
    }
    
    console.log(`\n🎉 DATABASE CLEANUP COMPLETE!`);
    console.log(`📊 Summary:`);
    console.log(`   - Orders checked: ${orders.length}`);
    console.log(`   - Items fixed: ${fixedCount}`);
    console.log(`   - Total corrupted objects removed: ${totalCorruptedFound}`);
    
    return { success: true, fixedCount, totalCorruptedFound };
    
  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    throw error;
  }
};

// Main execution
const runCleanup = async () => {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Run cleanup
    const result = await cleanupCorruptedData();
    
    console.log('\n🎉 Cleanup completed successfully!');
    console.log('Result:', result);
    
  } catch (error) {
    console.error('💥 Cleanup script failed:', error);
    process.exit(1);
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log('👋 MongoDB connection closed');
    process.exit(0);
  }
};

// Run the script
runCleanup();