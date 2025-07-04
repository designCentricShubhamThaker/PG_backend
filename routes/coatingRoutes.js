import express from 'express';

import { getCoatingOrders, updateCoatingTracking } from '../controllers/DecoCoatController.js';

const router = express.Router();

router.route('/')
  .get(getCoatingOrders)
  .patch(updateCoatingTracking)


export default router;