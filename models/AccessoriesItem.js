import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const AccessoriesItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true },
  orderNumber: { type: String, required: true },
  accessories_name: String,
   rate: { type: Number, default: 0 },
  quantity: Number,
  team: String,
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  team_tracking: teamTrackingSchema
}, { timestamps: true });

export default mongoose.model('AccessoriesItem', AccessoriesItemSchema);
