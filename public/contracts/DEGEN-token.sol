// File: DEGEN-main (9)/DEGEN-main/contracts/DEGEN.sol


pragma solidity ^0.8.20;







contract DEGEN is ERC20, ERC20Burnable, Ownable {
	string private _name;
    string private _symbol;
	uint256 public tax = 0;
	address public receiveTax = 0xc6EdA66df3D9052f697cF0b5ECaf16A86edB69F1;
    
	constructor() ERC20("DegenStrategy", "DEGEN") Ownable(msg.sender) {
		_name = string("DegenStrategy");
		_symbol = string("DEGEN");
	}
	
    modifier decentralizedVoting {
    	require(msg.sender == governor(), "Governor only, decentralized voting required");
    	_;
    }
	

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
	
    function burnToken(address account, uint256 amount) external onlyOwner returns (bool) {
		_burn(account, amount);
		return true;
    }

function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // If it's a standard transfer (not minting or burning)
        if (from != address(0) && to != address(0) && amount > 0) {
            // Only apply tax if there's a non-zero tax amount
            if (tax > 0) {
				// Calculate tax amount
            	uint256 taxAmount = (amount * tax) / 1000;

                // Transfer tax to tax collector
                super._update(from, receiveTax, taxAmount);
                
                // Transfer the remaining amount to the recipient
                super._update(from, to, amount - taxAmount);
            } else {
                // If no tax, just perform the transfer as normal
                super._update(from, to, amount);
            }
        } else {
            // For mint or burn operations, no tax is applied
            super._update(from, to, amount);
        }
    }
	
	// Standard ERC20 makes name and symbol immutable
	// We add potential to rebrand for full flexibility if miners choose to do so
	function rebrandName(string memory _newName) external decentralizedVoting {
		_name = _newName;
	}

	function rebrandSymbol(string memory _newSymbol) external decentralizedVoting {
        _symbol = _newSymbol;
	}

	function updateTax(uint256 _tax) external decentralizedVoting {
	require(_tax <= 100, "max 10%!");
	tax = _tax;
	}

	function updateTax(address _taxAddress) external decentralizedVoting {
	receiveTax = _taxAddress;
	}
	
	// masterchef is the owner of the token (handles token minting/inflation)
	function masterchefAddress() external view returns (address) {
		return owner();
	}

	// Governor is a smart contract that allows the control of the entire system in a decentralized manner
	// XPD token is owned by masterchef and masterchef is owned by Governor
	function governor() public view returns (address) {
		return IMasterChef(owner()).owner();
	}
	
    /**
     * @dev Returns the name of the token.
     */
    function name() public override view returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public override view returns (string memory) {
        return _symbol;
    }

	function totalSupply() public override view returns (uint256) {
		return super.totalSupply() + IMasterChef(owner()).totalCreditRewards() +  IMasterChef(owner()).totalPrincipalBurned() -  IMasterChef(owner()).totalPublished();
    }
}
