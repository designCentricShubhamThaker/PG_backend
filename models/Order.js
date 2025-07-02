import mongoose from 'mongoose';


const OrderSchema = new mongoose.Schema({
  order_number: { type: String, required: true, unique: true },
  dispatcher_name: { type: String, required: true },
  customer_name: { type: String, required: true },
  order_status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  created_by: { type: String }, 
  team: { type: String, }, 
  item_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem' }],
}, { timestamps: true });

export default mongoose.model('Order', OrderSchema);