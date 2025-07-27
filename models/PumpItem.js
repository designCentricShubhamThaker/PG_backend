import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const PumpItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true },
  orderNumber: { type: String, required: true },
  pump_name: String,
   rate: { type: Number, default: 0 },
  neck_type: String,
  quantity: Number,
  team: String,
 status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed'],
    default: 'Pending'
  },
  team_tracking: teamTrackingSchema
}, { timestamps: true });

export default mongoose.model('PumpItem', PumpItemSchema);