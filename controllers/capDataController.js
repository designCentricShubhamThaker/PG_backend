import CapData from '../models/CapData.js';

export const getAllCaps = async (req, res) => {
  try {
    const caps = await CapData.find();
    res.json(caps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createCap = async (req, res) => {
  try {
    const newCap = new CapData(req.body);
    await newCap.save();
    res.status(201).json(newCap);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updateCap = async (req, res) => {
  try {
    const cap = await CapData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(cap);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteCap = async (req, res) => {
  try {
    await CapData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Cap deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
