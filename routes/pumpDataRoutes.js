import express from 'express';
import {
  getAllPumps,
  createPump,
  updatePump,
  deletePump
} from '../controllers/PumpDataController.js';

const router = express.Router();

router.route('/')
  .get(getAllPumps)
  .post(createPump);

router.route('/:id')
  .put(updatePump)
  .delete(deletePump);

export default router;
