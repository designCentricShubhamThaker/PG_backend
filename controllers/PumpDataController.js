import PumpData from '../models/PumpData.js';

export const getAllPumps = async (req, res) => {
  try {
    const pumps = await PumpData.find();
    res.json(pumps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createPump = async (req, res) => {
  try {
    const newPump = new PumpData(req.body);
    await newPump.save();
    res.status(201).json(newPump);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updatePump = async (req, res) => {
  try {
    const pump = await PumpData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pump);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deletePump = async (req, res) => {
  try {
    await PumpData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Pump deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
