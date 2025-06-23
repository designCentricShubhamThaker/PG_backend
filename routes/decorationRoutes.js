import express from 'express';
import { getDecorationCombinations, getDecorationOrders, sendToDecorationTeam, updateDecorationTracking } from '../controllers/DecorationController.js';


const router = express.Router();

router
  .route('/decoration-orders')
  .get(getDecorationOrders);

router
  .route('/send-to-decoration')
  .post(sendToDecorationTeam);

router
  .route('/update-decoration-tracking')
  .put(updateDecorationTracking);

router
  .route('/decoration-combinations')
  .get(getDecorationCombinations);

export default router;
