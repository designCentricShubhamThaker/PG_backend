import mongoose from 'mongoose';

const OrderItemSchema = new mongoose.Schema({
  order_number: { type: String, required: true },
  name: { type: String }, 
  team_assignments: {
    glass: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GlassItem' }],
    caps: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CapItem' }],
    boxes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BoxItem' }],
    pumps: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PumpItem' }]
  },


}, { timestamps: true });

export default mongoose.model('OrderItem', OrderItemSchema);
