import AccessoryData from '../models/AccessoriesData.js';

export const getAllAccessories = async (req, res) => {
  try {
    const pumps = await AccessoryData.find();
    res.json(pumps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createAccessories = async (req, res) => {
  try {
    const newPump = new AccessoryData(req.body);
    await newPump.save();
    res.status(201).json(newPump);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updateAccessories = async (req, res) => {
  try {
    const pump = await AccessoryData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pump);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteAccessories = async (req, res) => {
  try {
    await AccessoryData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Pump deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
