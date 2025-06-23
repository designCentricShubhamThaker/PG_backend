import express from 'express';
import {
  getAllPumpItems,
 
  updatePumpTracking
} from '../controllers/pumpController.js';

const router = express.Router();

router.route('/')
  .get(getAllPumpItems)
  .patch(updatePumpTracking)


export default router;