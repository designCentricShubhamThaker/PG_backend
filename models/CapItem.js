import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const CapItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true },
  orderNumber: { type: String, required: true },
  cap_name: String,
  rate: { type: Number, default: 0 },
  neck_size: String,
  quantity: Number,
  process: {
    type: String,
    enum: [
      "Metal - Unassembly",
      "Non Metal - Unassembly",
      "Metal - Assembly",
      "Non Metal - Assembly"
    ],
    required: true
  },

  team: String,
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },

  metal_tracking: teamTrackingSchema,
  assembly_tracking: teamTrackingSchema

}, { timestamps: true });

export default mongoose.model('CapItem', CapItemSchema);