import AccessoriesData from '../models/AccessoriesData.js';

export const getAllAccessories = async (req, res) => {
  try {
    const accessories = await AccessoriesData.find();
    res.json(accessories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createAccessory = async (req, res) => {
  try {
    const newAccessory = new AccessoriesData(req.body);
    await newAccessory.save();
    res.status(201).json(newAccessory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updateAccessory = async (req, res) => {
  try {
    const accessory = await AccessoriesData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(accessory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteAccessory = async (req, res) => {
  try {
    await AccessoriesData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Accessory deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
