const calculateCommission = (role, price) => {
    switch(role) {
        case 'publisher':
            if (price <= 10000) return 0.06;
            if (price <= 20000) return 0.05;
            if (price <= 50000) return 0.04;
            return 0.03;
        case 'bookstore':
            return 0.02;
        case 'commission_store':
            return 0;
        case 'resell':
            return 0.08; // Can be overridden to 0.05 after admin approval
        default:
            return 0;
    }
};

module.exports = { calculateCommission };
