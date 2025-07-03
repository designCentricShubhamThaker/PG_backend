import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const PrintingItemSchema = new mongoose.Schema({
  glass_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'GlassItem', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true }, 
  orderNumber: { type: String, required: true },
  orderNumber: { type: String, required: true },
  quantity: { type: Number, required: true }, 
  
  team_tracking: teamTrackingSchema
}, { timestamps: true });

export default mongoose.model('PrintingItem', PrintingItemSchema);
