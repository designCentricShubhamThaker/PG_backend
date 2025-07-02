import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const FoilingItemSchema = new mongoose.Schema({
  glass_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'GlassItem', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true },
  orderNumber: { type: String, required: true },
  quantity: { type: Number, required: true },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed'],
    default: 'Pending'
  },
  team_tracking: teamTrackingSchema
}, { timestamps: true });

export default mongoose.model('FoilingItem', FoilingItemSchema);
