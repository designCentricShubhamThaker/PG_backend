import express from 'express';
import { getFrostOrders, updateFrostTracking } from '../controllers/DecoFrostController.js';

const router = express.Router();

router.route('/')
  .get(getFrostOrders)
  .patch(updateFrostTracking)


export default router;