import BottleData from '../models/BottleData.js';

export const getAllBottles = async (req, res) => {
  try {
    const bottles = await BottleData.find();
    res.json(bottles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createBottle = async (req, res) => {
  try {
    const newBottle = new BottleData(req.body);
    await newBottle.save();
    res.status(201).json(newBottle);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updateBottle = async (req, res) => {
  try {
    const bottle = await BottleData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(bottle);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteBottle = async (req, res) => {
  try {
    await BottleData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Bottle deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
