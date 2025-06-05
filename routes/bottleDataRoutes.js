import express from 'express';
import {
  getAllBottles,
  createBottle,
  updateBottle,
  deleteBottle
} from '../controllers/BottleDataController.js';

const router = express.Router();

router.route('/')
  .get(getAllBottles)
  .post(createBottle);

router.route('/:id')
  .put(updateBottle)
  .delete(deleteBottle);

export default router;
