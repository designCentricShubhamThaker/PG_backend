import mongoose from 'mongoose';

// Customer schema: name, email, shortAddress, phoneNumber
const CustomerDataSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  shortAddress: { type: String, required: true },
  phoneNumber: { type: String, required: true }
});

export default mongoose.model('CustomerData', CustomerDataSchema);
