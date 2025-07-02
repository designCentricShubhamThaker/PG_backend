import express from 'express';
import {
  getPrintingOrders,
  updatePrintingTracking,
} from '../controllers/DecoPrintController.js';

const router = express.Router();

router.route('/')
  .get(getPrintingOrders)
  .patch(updatePrintingTracking)


export default router;