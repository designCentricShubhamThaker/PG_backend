import express from 'express';
import { getFoilOrders, updateFoilTracking } from '../controllers/DecoFoilController.js';

const router = express.Router();

router.route('/')
  .get(getFoilOrders)
  .patch(updateFoilTracking)


export default router;