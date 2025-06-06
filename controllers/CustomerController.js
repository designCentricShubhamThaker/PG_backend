import CustomerData from '../models/CustomerData.js';

export const getAllCustomers = async (req, res) => {
  try {
    const customers = await CustomerData.find();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createCustomer = async (req, res) => {
  try {
    const newCustomer = new CustomerData(req.body);
    await newCustomer.save();
    res.status(201).json(newCustomer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updateCustomer = async (req, res) => {
  try {
    const customer = await CustomerData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(customer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteCustomer = async (req, res) => {
  try {
    await CustomerData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
