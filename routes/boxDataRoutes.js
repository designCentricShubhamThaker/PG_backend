import express from 'express';
import {
  getAllBoxes,

  createBox,
  updateBox,
  deleteBox
} from '../controllers/BoxDataController.js';

const router = express.Router();

router.route('/')
  .get(getAllBoxes)
  .post(createBox);

router.route('/:id')

  .put(updateBox)
  .delete(deleteBox);

export default router;
