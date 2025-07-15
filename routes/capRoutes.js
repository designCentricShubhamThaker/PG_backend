import express from 'express';
import {
  getCapOrders,
  updateCapTracking,
 
} from '../controllers/capController.js';

const router = express.Router();

router.route('/')
  .get(getCapOrders)
  .patch(updateCapTracking)



export default router;