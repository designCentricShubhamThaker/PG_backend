import BoxData from '../models/BoxData.js';

export const getAllBoxes = async (req, res) => {
  try {
    const boxes = await BoxData.find();
    res.json(boxes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createBox = async (req, res) => {
  try {
    const newBox = new BoxData(req.body);
    await newBox.save();
    res.status(201).json(newBox);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const updateBox = async (req, res) => {
  try {
    const box = await BoxData.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(box);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteBox = async (req, res) => {
  try {
    await BoxData.findByIdAndDelete(req.params.id);
    res.json({ message: 'Box deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
