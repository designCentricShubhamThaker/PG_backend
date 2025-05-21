import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const BoxItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true },
  orderNumber: { type: String, required: true },
  box_name: String,
  quantity: Number,
  approval_code: String,
  team: String,
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  team_tracking: teamTrackingSchema
}, { timestamps: true });

export default mongoose.model('BoxItem', BoxItemSchema);